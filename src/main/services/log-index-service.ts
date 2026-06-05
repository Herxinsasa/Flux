import fs from 'fs'
import path from 'path'
import { detectEncoding } from './file-service'
import { readFileLineRange } from './file-service'
import type { LogIndexPayload } from '../../shared/types'
import {
  LOG_INDEX_MAX_PATTERN_LINES,
  LOG_INDEX_SUMMARY_MAX_CHARS,
} from '../../shared/context-budget'
import * as iconv from 'iconv-lite'

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

interface CacheEntry {
  mtimeMs: number
  index: LogIndexPayload
}

const indexCache = new Map<string, CacheEntry>()

function classifyLine(line: string): keyof LogIndexPayload['levelCounts'] | null {
  if (LEVEL_RE.fatal.test(line)) return 'fatal'
  if (LEVEL_RE.error.test(line)) return 'error'
  if (LEVEL_RE.warn.test(line)) return 'warn'
  if (LEVEL_RE.info.test(line)) return 'info'
  if (LEVEL_RE.debug.test(line)) return 'debug'
  return null
}

function buildSummaryText(index: Omit<LogIndexPayload, 'summaryText'>): string {
  const parts: string[] = [
    `Log index: ${path.basename(index.path)}`,
    `Size: ${(index.sizeBytes / (1024 * 1024)).toFixed(1)} MB | Lines: ~${index.totalLines.toLocaleString()} | ${index.encoding}`,
    `Levels: FATAL ${index.levelCounts.fatal} | ERROR ${index.levelCounts.error} | WARN ${index.levelCounts.warn} | INFO ${index.levelCounts.info} | DEBUG ${index.levelCounts.debug}`,
  ]
  if (index.errorSampleLines.length > 0) {
    const sample = index.errorSampleLines.slice(0, 12).join(', ')
    parts.push(`ERROR sample lines: ${sample}${index.errorSampleLines.length > 12 ? '…' : ''}`)
  }
  if (index.warnSampleLines.length > 0) {
    const sample = index.warnSampleLines.slice(0, 8).join(', ')
    parts.push(`WARN sample lines: ${sample}${index.warnSampleLines.length > 8 ? '…' : ''}`)
  }
  parts.push('Use search_content(pattern, path) then read_file(offset, limit). Full file is not in context.')
  let text = parts.join('\n')
  if (text.length > LOG_INDEX_SUMMARY_MAX_CHARS) {
    text = text.slice(0, LOG_INDEX_SUMMARY_MAX_CHARS) + '\n… [index truncated]'
  }
  return text
}

/**
 * Stream-scan a log file and build a lightweight index (no full content in memory).
 */
export function buildLogIndex(filePath: string): LogIndexPayload {
  const resolved = path.resolve(filePath)
  const stat = fs.statSync(resolved)
  const probeSize = Math.min(stat.size, 64 * 1024)
  const probeBuf = Buffer.alloc(probeSize)
  const fd = fs.openSync(resolved, 'r')
  fs.readSync(fd, probeBuf, 0, probeSize, 0)
  fs.closeSync(fd)
  const encoding = detectEncoding(probeBuf)

  const levelCounts = { fatal: 0, error: 0, warn: 0, info: 0, debug: 0 }
  const errorSampleLines: number[] = []
  const warnSampleLines: number[] = []
  const patternHits = new Map<string, number>()

  let lineIndex = 0
  let carry = ''
  const chunkSize = 256 * 1024
  let pos = 0
  const readFd = fs.openSync(resolved, 'r')

  while (pos < stat.size) {
    const toRead = Math.min(chunkSize, stat.size - pos)
    const buf = Buffer.alloc(toRead)
    fs.readSync(readFd, buf, 0, toRead, pos)
    pos += toRead
    const text = carry + iconv.decode(buf, encoding)
    const parts = text.split('\n')
    carry = parts.pop() ?? ''

    for (const line of parts) {
      lineIndex++
      const level = classifyLine(line)
      if (level) levelCounts[level]++

      if (
        (level === 'error' || level === 'fatal') &&
        errorSampleLines.length < LOG_INDEX_MAX_PATTERN_LINES
      ) {
        errorSampleLines.push(lineIndex)
      }
      if (level === 'warn' && warnSampleLines.length < LOG_INDEX_MAX_PATTERN_LINES) {
        warnSampleLines.push(lineIndex)
      }

      for (const p of HOT_PATTERN_RES) {
        if (p.re.test(line)) {
          patternHits.set(p.name, (patternHits.get(p.name) ?? 0) + 1)
        }
      }
    }
  }

  if (carry.length > 0) {
    lineIndex++
    const level = classifyLine(carry)
    if (level) levelCounts[level]++
  }

  fs.closeSync(readFd)

  const base: Omit<LogIndexPayload, 'summaryText'> = {
    path: resolved,
    sizeBytes: stat.size,
    totalLines: lineIndex,
    encoding,
    levelCounts,
    errorSampleLines,
    warnSampleLines,
  }

  return {
    ...base,
    summaryText: buildSummaryText(base),
  }
}

export function getLogIndex(filePath: string, force = false): LogIndexPayload {
  const resolved = path.resolve(filePath)
  const stat = fs.statSync(resolved)
  const cached = indexCache.get(resolved)
  if (!force && cached && cached.mtimeMs === stat.mtimeMs) {
    return cached.index
  }
  const index = buildLogIndex(resolved)
  indexCache.set(resolved, { mtimeMs: stat.mtimeMs, index })
  return index
}

export function evictLogIndex(filePath: string): void {
  indexCache.delete(path.resolve(filePath))
}

export function readLogLines(
  filePath: string,
  offset = 0,
  limit = 500,
): { startLine: number; endLine: number; totalLines: number; lines: string[] } {
  const range = readFileLineRange(filePath, offset, limit)
  const lines = range.content ? range.content.split('\n') : []
  return {
    startLine: range.startLine,
    endLine: range.endLine,
    totalLines: range.totalLines,
    lines,
  }
}
