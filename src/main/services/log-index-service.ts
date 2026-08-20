import fs from 'fs'
import path from 'path'
import * as iconv from 'iconv-lite'
import { detectEncoding } from './file-service'
import type { LogIndexPayload, LogIndexTaskEvent, TaskStartData } from '../../shared/types'
import {
  LOG_INDEX_MAX_PATTERN_LINES,
  LOG_INDEX_SUMMARY_MAX_CHARS,
} from '../../shared/context-budget'

const CHUNK_SIZE = 256 * 1024
const PAGE_READ_BYTES = 64 * 1024
const OFFSET_STRIDE = 128

const LEVEL_RE = {
  fatal: /\b(FATAL|CRITICAL)\b/i,
  error: /\b(ERROR|ERR|SEVERE|Exception)\b/i,
  warn: /\b(WARN|WARNING)\b/i,
  info: /\b(INFO|INFORMATION|SUCCESS)\b/i,
  debug: /\b(DEBUG|TRACE|VERBOSE)\b/i,
}

const HOT_PATTERN_RES = [
  { name: 'Exception', re: /Exception/i },
  { name: 'timeout', re: /timeout/i },
  { name: 'ERROR', re: /\bERROR\b/i },
  { name: 'FATAL', re: /\bFATAL\b/i },
]

type LevelCounts = LogIndexPayload['levelCounts']

interface LineOffset {
  line: number
  offset: number
}

interface IndexState {
  totalLines: number
  levelCounts: LevelCounts
  errorSampleLines: number[]
  warnSampleLines: number[]
  patternHits: Map<string, number>
  lineOffsets: LineOffset[]
  carry: Buffer
  endsWithNewline: boolean
}

interface CacheEntry {
  size: number
  mtimeMs: number
  index: LogIndexPayload
  lineOffsets: LineOffset[]
  endsWithNewline: boolean
  dataStartOffset: number
}

interface LogIndexTask {
  cancelled: boolean
}

const indexCache = new Map<string, CacheEntry>()
const latestCacheKeyByPath = new Map<string, string>()
const indexTasks = new Map<string, LogIndexTask>()
const backgroundIndexTasks = new Map<string, Promise<void>>()

function cacheKey(filePath: string, size: number, mtimeMs: number): string {
  return `${path.resolve(filePath)}\u0000${size}\u0000${mtimeMs}`
}

function getCachedEntry(filePath: string): CacheEntry | undefined {
  const resolved = path.resolve(filePath)
  const key = latestCacheKeyByPath.get(resolved)
  return key ? indexCache.get(key) : undefined
}

function setCachedEntry(filePath: string, entry: CacheEntry): void {
  const resolved = path.resolve(filePath)
  const previous = latestCacheKeyByPath.get(resolved)
  if (previous) indexCache.delete(previous)
  const key = cacheKey(resolved, entry.size, entry.mtimeMs)
  indexCache.set(key, entry)
  latestCacheKeyByPath.set(resolved, key)
}

function newlineBytes(encoding: string): Buffer {
  if (encoding === 'utf16le') return Buffer.from([0x0a, 0x00])
  if (encoding === 'utf16be') return Buffer.from([0x00, 0x0a])
  return Buffer.from([0x0a])
}

function findNewline(
  buffer: Buffer,
  start: number,
  newline: Buffer,
  bufferOffset: number,
  dataStartOffset: number,
): number {
  if (newline.length === 1) return buffer.indexOf(newline[0], start)
  const firstAligned = start + ((dataStartOffset - (bufferOffset + start)) & 1)
  for (let index = firstAligned; index <= buffer.length - newline.length; index += 2) {
    if (buffer[index] === newline[0] && buffer[index + 1] === newline[1]) return index
  }
  return -1
}

function nextTaskId(): string {
  return `log-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve))
}

function classifyLine(line: string): keyof LevelCounts | null {
  if (LEVEL_RE.fatal.test(line)) return 'fatal'
  if (LEVEL_RE.error.test(line)) return 'error'
  if (LEVEL_RE.warn.test(line)) return 'warn'
  if (LEVEL_RE.info.test(line)) return 'info'
  if (LEVEL_RE.debug.test(line)) return 'debug'
  return null
}

function createState(dataStartOffset: number, existing?: CacheEntry): IndexState {
  if (!existing) {
    return {
      totalLines: 0,
      levelCounts: { fatal: 0, error: 0, warn: 0, info: 0, debug: 0 },
      errorSampleLines: [],
      warnSampleLines: [],
      patternHits: new Map(),
      lineOffsets: [{ line: 0, offset: dataStartOffset }],
      carry: Buffer.alloc(0),
      endsWithNewline: true,
    }
  }
  return {
    totalLines: existing.index.totalLines,
    levelCounts: { ...existing.index.levelCounts },
    errorSampleLines: [...existing.index.errorSampleLines],
    warnSampleLines: [...existing.index.warnSampleLines],
    patternHits: new Map(),
    lineOffsets: [...existing.lineOffsets],
    carry: Buffer.alloc(0),
    endsWithNewline: true,
  }
}

function recordLine(state: IndexState, lineBuffer: Buffer, encoding: string, nextLineOffset: number): void {
  const line = iconv.decode(lineBuffer, encoding).replace(/\r$/, '')
  state.totalLines++
  const level = classifyLine(line)
  if (level) state.levelCounts[level]++
  if ((level === 'error' || level === 'fatal') && state.errorSampleLines.length < LOG_INDEX_MAX_PATTERN_LINES) {
    state.errorSampleLines.push(state.totalLines)
  }
  if (level === 'warn' && state.warnSampleLines.length < LOG_INDEX_MAX_PATTERN_LINES) {
    state.warnSampleLines.push(state.totalLines)
  }
  for (const pattern of HOT_PATTERN_RES) {
    if (pattern.re.test(line)) state.patternHits.set(pattern.name, (state.patternHits.get(pattern.name) ?? 0) + 1)
  }
  if (state.totalLines % OFFSET_STRIDE === 0) {
    state.lineOffsets.push({ line: state.totalLines, offset: nextLineOffset })
  }
}

function processChunk(
  state: IndexState,
  chunk: Buffer,
  chunkOffset: number,
  encoding: string,
  dataStartOffset: number,
): void {
  const combined = state.carry.length > 0 ? Buffer.concat([state.carry, chunk]) : chunk
  const combinedOffset = chunkOffset - state.carry.length
  const newlineBytesForEncoding = newlineBytes(encoding)
  let cursor = 0
  let newline = findNewline(
    combined,
    cursor,
    newlineBytesForEncoding,
    combinedOffset,
    dataStartOffset,
  )
  while (newline !== -1) {
    const line = combined.subarray(cursor, newline)
    state.carry = Buffer.alloc(0)
    recordLine(state, line, encoding, combinedOffset + newline + newlineBytesForEncoding.length)
    cursor = newline + newlineBytesForEncoding.length
    newline = findNewline(
      combined,
      cursor,
      newlineBytesForEncoding,
      combinedOffset,
      dataStartOffset,
    )
  }
  state.carry = Buffer.from(combined.subarray(cursor))
  state.endsWithNewline = state.carry.length === 0
}

function finishScan(state: IndexState, encoding: string, fileSize: number): void {
  if (state.carry.length > 0) {
    recordLine(state, state.carry, encoding, fileSize)
    state.carry = Buffer.alloc(0)
    state.endsWithNewline = false
  }
}

function buildSummaryText(index: Omit<LogIndexPayload, 'summaryText'>): string {
  const parts = [
    `Log index: ${path.basename(index.path)}`,
    `Size: ${(index.sizeBytes / (1024 * 1024)).toFixed(1)} MB | Lines: ~${index.totalLines.toLocaleString()} | ${index.encoding}`,
    `Levels: FATAL ${index.levelCounts.fatal} | ERROR ${index.levelCounts.error} | WARN ${index.levelCounts.warn} | INFO ${index.levelCounts.info} | DEBUG ${index.levelCounts.debug}`,
  ]
  if (index.errorSampleLines.length > 0) parts.push(`ERROR sample lines: ${index.errorSampleLines.slice(0, 12).join(', ')}`)
  if (index.warnSampleLines.length > 0) parts.push(`WARN sample lines: ${index.warnSampleLines.slice(0, 8).join(', ')}`)
  parts.push('Use search_content(pattern, path) then read_file(offset, limit). Full file is not in context.')
  const text = parts.join('\n')
  return text.length > LOG_INDEX_SUMMARY_MAX_CHARS
    ? `${text.slice(0, LOG_INDEX_SUMMARY_MAX_CHARS)}\n… [index truncated]`
    : text
}

function toCacheEntry(
  filePath: string,
  stat: fs.Stats,
  encoding: string,
  dataStartOffset: number,
  state: IndexState,
): CacheEntry {
  const base: Omit<LogIndexPayload, 'summaryText'> = {
    path: path.resolve(filePath),
    sizeBytes: stat.size,
    totalLines: state.totalLines,
    encoding,
    levelCounts: state.levelCounts,
    errorSampleLines: state.errorSampleLines,
    warnSampleLines: state.warnSampleLines,
  }
  return {
    size: stat.size,
    mtimeMs: stat.mtimeMs,
    index: { ...base, summaryText: buildSummaryText(base) },
    lineOffsets: state.lineOffsets,
    endsWithNewline: state.endsWithNewline,
    dataStartOffset,
  }
}

interface EncodingProbe {
  encoding: string
  dataStartOffset: number
}

function probeEncoding(buffer: Buffer): EncodingProbe {
  const encoding = detectEncoding(buffer)
  const hasUtf16Bom =
    (buffer[0] === 0xff && buffer[1] === 0xfe) ||
    (buffer[0] === 0xfe && buffer[1] === 0xff)
  return { encoding, dataStartOffset: hasUtf16Bom ? 2 : 0 }
}

function readEncodingSync(filePath: string, size: number): EncodingProbe {
  const probeSize = Math.min(size, 64 * 1024)
  const buffer = Buffer.alloc(probeSize)
  const fd = fs.openSync(filePath, 'r')
  try {
    fs.readSync(fd, buffer, 0, probeSize, 0)
  } finally {
    fs.closeSync(fd)
  }
  return probeEncoding(buffer)
}

async function readEncoding(filePath: string, size: number): Promise<EncodingProbe> {
  const probeSize = Math.min(size, 64 * 1024)
  const buffer = Buffer.alloc(probeSize)
  const handle = await fs.promises.open(filePath, 'r')
  try {
    await handle.read(buffer, 0, probeSize, 0)
  } finally {
    await handle.close()
  }
  return probeEncoding(buffer)
}

function canAppend(cached: CacheEntry | undefined, stat: fs.Stats): cached is CacheEntry {
  return Boolean(cached && stat.size > cached.size && stat.mtimeMs >= cached.mtimeMs && cached.endsWithNewline)
}

function buildEntrySync(filePath: string, stat: fs.Stats, existing?: CacheEntry): CacheEntry {
  const probe = existing
    ? { encoding: existing.index.encoding, dataStartOffset: existing.dataStartOffset }
    : readEncodingSync(filePath, stat.size)
  const { encoding, dataStartOffset } = probe
  const state = createState(dataStartOffset, existing)
  const start = existing?.size ?? dataStartOffset
  const fd = fs.openSync(filePath, 'r')
  try {
    for (let offset = start; offset < stat.size; ) {
      const size = Math.min(CHUNK_SIZE, stat.size - offset)
      const buffer = Buffer.alloc(size)
      fs.readSync(fd, buffer, 0, size, offset)
      processChunk(state, buffer, offset, encoding, dataStartOffset)
      offset += size
    }
  } finally {
    fs.closeSync(fd)
  }
  finishScan(state, encoding, stat.size)
  return toCacheEntry(filePath, stat, encoding, dataStartOffset, state)
}

async function buildEntryAsync(
  filePath: string,
  stat: fs.Stats,
  existing: CacheEntry | undefined,
  isCancelled?: () => boolean,
  onProgress?: (loadedBytes: number) => void,
): Promise<CacheEntry> {
  const probe = existing
    ? { encoding: existing.index.encoding, dataStartOffset: existing.dataStartOffset }
    : await readEncoding(filePath, stat.size)
  const { encoding, dataStartOffset } = probe
  const state = createState(dataStartOffset, existing)
  const start = existing?.size ?? dataStartOffset
  const handle = await fs.promises.open(filePath, 'r')
  try {
    for (let offset = start; offset < stat.size; ) {
      if (isCancelled?.()) throw new Error('CANCELLED')
      const size = Math.min(CHUNK_SIZE, stat.size - offset)
      const buffer = Buffer.alloc(size)
      const { bytesRead } = await handle.read(buffer, 0, size, offset)
      if (bytesRead === 0) break
      processChunk(state, buffer.subarray(0, bytesRead), offset, encoding, dataStartOffset)
      offset += bytesRead
      onProgress?.(offset)
      await yieldToEventLoop()
    }
  } finally {
    await handle.close()
  }
  if (isCancelled?.()) throw new Error('CANCELLED')
  finishScan(state, encoding, stat.size)
  return toCacheEntry(filePath, stat, encoding, dataStartOffset, state)
}

function getCachedOrBuildSync(filePath: string, force = false): CacheEntry {
  const resolved = path.resolve(filePath)
  const stat = fs.statSync(resolved)
  const cached = getCachedEntry(resolved)
  if (!force && isExactCache(cached, stat)) return cached
  const entry = buildEntrySync(resolved, stat, !force && canAppend(cached, stat) ? cached : undefined)
  setCachedEntry(resolved, entry)
  return entry
}

function isExactCache(cached: CacheEntry | undefined, stat: fs.Stats): cached is CacheEntry {
  return Boolean(cached && cached.size === stat.size && cached.mtimeMs === stat.mtimeMs)
}

/** Synchronous compatibility API used by Agent context assembly. */
export function buildLogIndex(filePath: string): LogIndexPayload {
  const resolved = path.resolve(filePath)
  const stat = fs.statSync(resolved)
  const entry = buildEntrySync(resolved, stat)
  setCachedEntry(resolved, entry)
  return entry.index
}

/** Synchronous compatibility API used by Agent context assembly. */
export function getLogIndex(filePath: string, force = false): LogIndexPayload {
  const resolved = path.resolve(filePath)
  const stat = fs.statSync(resolved)
  const cached = getCachedEntry(resolved)
  if (!force && isExactCache(cached, stat)) return cached.index
  const entry = buildEntrySync(resolved, stat, !force && canAppend(cached, stat) ? cached : undefined)
  setCachedEntry(resolved, entry)
  return entry.index
}

/** Return only an exact index already in memory. This function never scans a file. */
export function getCachedLogIndex(filePath: string): LogIndexPayload | undefined {
  const resolved = path.resolve(filePath)
  try {
    const cached = getCachedEntry(resolved)
    return isExactCache(cached, fs.statSync(resolved)) ? cached.index : undefined
  } catch {
    return undefined
  }
}

/** Start an unobserved, de-duplicated index build without blocking the caller. */
export function scheduleLogIndex(filePath: string): void {
  const resolved = path.resolve(filePath)
  if (backgroundIndexTasks.has(resolved)) return
  const task = getLogIndexAsync(resolved)
    .then(() => undefined)
    .catch((error) => {
      // Context enrichment is opportunistic; UI indexing surfaces actionable errors separately.
      console.warn('Background log index failed', resolved, error)
    })
    .finally(() => backgroundIndexTasks.delete(resolved))
  backgroundIndexTasks.set(resolved, task)
}

export async function getLogIndexAsync(filePath: string, force = false): Promise<LogIndexPayload> {
  const resolved = path.resolve(filePath)
  const stat = await fs.promises.stat(resolved)
  const cached = getCachedEntry(resolved)
  if (!force && isExactCache(cached, stat)) return cached.index
  const entry = await buildEntryAsync(resolved, stat, !force && canAppend(cached, stat) ? cached : undefined)
  setCachedEntry(resolved, entry)
  return entry.index
}

export function startLogIndexTask(
  filePath: string,
  onEvent: (event: LogIndexTaskEvent) => void,
): TaskStartData {
  const taskId = nextTaskId()
  const task: LogIndexTask = { cancelled: false }
  indexTasks.set(taskId, task)
  const resolved = path.resolve(filePath)

  void (async () => {
    const emit = (event: Omit<LogIndexTaskEvent, 'taskId'>) => onEvent({ taskId, ...event })
    try {
      const stat = await fs.promises.stat(resolved)
      const cached = getCachedEntry(resolved)
      const entry = isExactCache(cached, stat)
        ? cached
        : await buildEntryAsync(
          resolved,
          stat,
          canAppend(cached, stat) ? cached : undefined,
          () => task.cancelled,
          (loadedBytes) => emit({ status: 'progress', loadedBytes, totalBytes: stat.size }),
        )
      if (task.cancelled) {
        emit({ status: 'cancelled' })
        return
      }
      setCachedEntry(resolved, entry)
      emit({ status: 'complete', data: entry.index })
    } catch (error) {
      if (task.cancelled || (error instanceof Error && error.message === 'CANCELLED')) emit({ status: 'cancelled' })
      else emit({ status: 'error', error: error instanceof Error ? error.message : String(error) })
    } finally {
      indexTasks.delete(taskId)
    }
  })()

  return { taskId }
}

export function cancelLogIndexTask(taskId: string): boolean {
  const task = indexTasks.get(taskId)
  if (!task) return false
  task.cancelled = true
  return true
}

export function evictLogIndex(filePath: string): void {
  const resolved = path.resolve(filePath)
  const key = latestCacheKeyByPath.get(resolved)
  if (key) indexCache.delete(key)
  latestCacheKeyByPath.delete(resolved)
}

function readPage(entry: CacheEntry, filePath: string, offset: number, limit: number): string[] {
  const startLine = Math.max(0, offset)
  const nearest = entry.lineOffsets.reduce((best, candidate) => candidate.line <= startLine ? candidate : best, entry.lineOffsets[0])
  const fd = fs.openSync(filePath, 'r')
  const lines: string[] = []
  let lineNumber = nearest.line
  let position = nearest.offset
  let carry = Buffer.alloc(0)
  const newlineBytesForEncoding = newlineBytes(entry.index.encoding)
  try {
    while (position < entry.size && lines.length < limit) {
      const size = Math.min(PAGE_READ_BYTES, entry.size - position)
      const chunk = Buffer.alloc(size)
      const bytesRead = fs.readSync(fd, chunk, 0, size, position)
      if (bytesRead === 0) break
      position += bytesRead
      const combined = carry.length > 0 ? Buffer.concat([carry, chunk.subarray(0, bytesRead)]) : chunk.subarray(0, bytesRead)
      let cursor = 0
      const combinedOffset = position - bytesRead - carry.length
      let newline = findNewline(
        combined,
        cursor,
        newlineBytesForEncoding,
        combinedOffset,
        entry.dataStartOffset,
      )
      while (newline !== -1) {
        const line = combined.subarray(cursor, newline)
        carry = Buffer.alloc(0)
        if (lineNumber >= startLine) lines.push(iconv.decode(line, entry.index.encoding).replace(/\r$/, ''))
        lineNumber++
        if (lines.length >= limit) return lines
        cursor = newline + newlineBytesForEncoding.length
        newline = findNewline(
          combined,
          cursor,
          newlineBytesForEncoding,
          combinedOffset,
          entry.dataStartOffset,
        )
      }
      carry = Buffer.from(combined.subarray(cursor))
    }
    if (carry.length > 0 && lineNumber >= startLine && lines.length < limit) {
      lines.push(iconv.decode(carry, entry.index.encoding).replace(/\r$/, ''))
    }
  } finally {
    fs.closeSync(fd)
  }
  return lines
}

/** Synchronous compatibility API. Pages start from the nearest indexed byte offset. */
export function readLogLines(
  filePath: string,
  offset = 0,
  limit = 500,
): { startLine: number; endLine: number; totalLines: number; lines: string[] } {
  const entry = getCachedOrBuildSync(filePath)
  const start = Math.min(Math.max(0, Math.floor(offset)), entry.index.totalLines)
  const lines = readPage(entry, entry.index.path, start, Math.max(0, Math.floor(limit)))
  return {
    startLine: start + 1,
    endLine: start + lines.length,
    totalLines: entry.index.totalLines,
    lines,
  }
}

export async function readLogLinesAsync(
  filePath: string,
  offset = 0,
  limit = 500,
): Promise<{ startLine: number; endLine: number; totalLines: number; lines: string[] }> {
  await getLogIndexAsync(filePath)
  return readLogLines(filePath, offset, limit)
}
