import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import * as iconv from 'iconv-lite'
import type {
  FileInfo,
  FileVersion,
  FluxErrorCode,
  LineEnding,
  SaveTextRequest,
  SaveTextResult,
  TextDocumentSnapshot,
  TextEncoding,
} from '../../shared/types'
import {
  READ_FILE_DEFAULT_LIMIT,
  READ_FILE_MAX_CHARS,
  READ_FILE_MAX_LINES,
} from '../../shared/context-budget'

/**
 * Detect file encoding by checking BOM first, then validating UTF-8.
 * Falls back to GBK if UTF-8 decoding fails (common for CJK log files).
 */
export function detectEncoding(buffer: Buffer): string {
  // UTF-8 BOM: EF BB BF
  if (buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) return 'utf8'
  // UTF-16 LE BOM: FF FE
  if (buffer[0] === 0xff && buffer[1] === 0xfe) return 'utf16le'
  // UTF-16 BE BOM: FE FF
  if (buffer[0] === 0xfe && buffer[1] === 0xff) return 'utf16be'

  // Try UTF-8 first; if invalid sequences found, fall back to GBK
  try {
    const decoded = buffer.toString('utf8')
    // Check for replacement characters that indicate encoding mismatch
    // eslint-disable-next-line no-control-regex
    if (decoded.indexOf('�') !== -1) {
      return 'gbk'
    }
    return 'utf8'
  } catch {
    return 'gbk'
  }
}

export class FluxFileError extends Error {
  constructor(
    public readonly code: FluxErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'FluxFileError'
  }
}

function hashBuffer(buffer: Buffer): string {
  return crypto.createHash('sha256').update(buffer).digest('hex')
}

function detectUtf16WithoutBom(buffer: Buffer): TextEncoding | null {
  if (buffer.length < 4) return null
  const sampleLength = Math.min(buffer.length, 4096)
  let evenNulls = 0
  let oddNulls = 0
  for (let index = 0; index < sampleLength; index += 1) {
    if (buffer[index] !== 0) continue
    if (index % 2 === 0) evenNulls += 1
    else oddNulls += 1
  }
  const pairs = Math.floor(sampleLength / 2)
  if (oddNulls / pairs > 0.3 && evenNulls / pairs < 0.05) return 'utf16le'
  if (evenNulls / pairs > 0.3 && oddNulls / pairs < 0.05) return 'utf16be'
  return null
}

export function detectTextEncoding(buffer: Buffer): TextEncoding {
  if (buffer.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]))) return 'utf8-bom'
  if (buffer.subarray(0, 2).equals(Buffer.from([0xff, 0xfe]))) return 'utf16le'
  if (buffer.subarray(0, 2).equals(Buffer.from([0xfe, 0xff]))) return 'utf16be'
  const inferredUtf16 = detectUtf16WithoutBom(buffer)
  if (inferredUtf16) return inferredUtf16
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(buffer)
    return 'utf8'
  } catch {
    return 'gbk'
  }
}

function isProbablyBinary(buffer: Buffer, encoding: TextEncoding): boolean {
  if (encoding === 'utf16le' || encoding === 'utf16be') return false
  const sampleLength = Math.min(buffer.length, 8192)
  if (sampleLength === 0) return false
  let suspicious = 0
  for (let index = 0; index < sampleLength; index += 1) {
    const byte = buffer[index]
    if (byte === 0) return true
    if (byte < 0x08 || (byte > 0x0d && byte < 0x20)) suspicious += 1
  }
  return suspicious / sampleLength > 0.02
}

function decodeText(buffer: Buffer, encoding: TextEncoding): string {
  const iconvEncoding = encoding === 'utf8-bom' ? 'utf8' : encoding
  return iconv.decode(buffer, iconvEncoding).replace(/^\uFEFF/, '')
}

function detectLineEnding(content: string): LineEnding {
  const crlfCount = content.match(/\r\n/g)?.length ?? 0
  const lfCount = content.match(/(^|[^\r])\n/g)?.length ?? 0
  return crlfCount > lfCount ? 'crlf' : 'lf'
}

function getVersionFromBuffer(stat: fs.Stats, buffer: Buffer): FileVersion {
  return {
    mtimeMs: stat.mtimeMs,
    size: stat.size,
    contentHash: hashBuffer(buffer),
  }
}

export function readText(filePath: string): TextDocumentSnapshot {
  if (!path.isAbsolute(filePath)) {
    throw new FluxFileError('INVALID_DATA', 'Text file path must be absolute')
  }
  let stat: fs.Stats
  let buffer: Buffer
  try {
    stat = fs.statSync(filePath)
    buffer = fs.readFileSync(filePath)
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException
    const code = nodeError.code === 'ENOENT' ? 'NOT_FOUND' : nodeError.code === 'EACCES' ? 'PERMISSION_DENIED' : 'IO_ERROR'
    throw new FluxFileError(code, `Failed to read text file: ${nodeError.message}`)
  }
  if (!stat.isFile()) throw new FluxFileError('UNSUPPORTED_FORMAT', 'Path is not a regular file')
  const encoding = detectTextEncoding(buffer)
  if (isProbablyBinary(buffer, encoding)) {
    throw new FluxFileError('UNSUPPORTED_FORMAT', 'Binary files are not supported')
  }
  const content = decodeText(buffer, encoding)
  return {
    filePath: path.resolve(filePath),
    content,
    encoding,
    lineEnding: detectLineEnding(content),
    version: getVersionFromBuffer(stat, buffer),
    sampled: false,
  }
}

function encodeText(content: string, encoding: TextEncoding): Buffer {
  const iconvEncoding = encoding === 'utf8-bom' ? 'utf8' : encoding
  const encoded = iconv.encode(content, iconvEncoding)
  if (decodeText(encoded, encoding) !== content) {
    throw new FluxFileError(
      'ENCODING_UNREPRESENTABLE',
      `Content cannot be represented as ${encoding}`,
    )
  }
  if (encoding === 'utf8-bom') return Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), encoded])
  if (encoding === 'utf16le') return Buffer.concat([Buffer.from([0xff, 0xfe]), encoded])
  if (encoding === 'utf16be') return Buffer.concat([Buffer.from([0xfe, 0xff]), encoded])
  return encoded
}

function normalizeLineEndings(content: string, lineEnding: LineEnding): string {
  const normalized = content.replace(/\r\n|\r/g, '\n')
  return lineEnding === 'crlf' ? normalized.replace(/\n/g, '\r\n') : normalized
}

function versionsMatch(expected: FileVersion, actual: FileVersion): boolean {
  return expected.mtimeMs === actual.mtimeMs &&
    expected.size === actual.size &&
    expected.contentHash === actual.contentHash
}

async function renameWithRetry(tempPath: string, targetPath: string): Promise<void> {
  const retryable = new Set(['EACCES', 'EBUSY', 'EPERM'])
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      await fs.promises.rename(tempPath, targetPath)
      return
    } catch (error) {
      const nodeError = error as NodeJS.ErrnoException
      if (!retryable.has(nodeError.code ?? '') || attempt === 3) throw error
      await new Promise((resolve) => setTimeout(resolve, 40 * (attempt + 1)))
    }
  }
}

export async function saveText(request: SaveTextRequest): Promise<SaveTextResult> {
  if (!path.isAbsolute(request.filePath)) {
    throw new FluxFileError('INVALID_DATA', 'Text file path must be absolute')
  }
  const current = readText(request.filePath)
  if (!versionsMatch(request.expectedVersion, current.version)) {
    throw new FluxFileError('VERSION_CONFLICT', 'File changed on disk since it was opened')
  }
  const content = normalizeLineEndings(request.content, request.lineEnding)
  const encoded = encodeText(content, request.encoding)
  const targetPath = path.resolve(request.filePath)
  const tempPath = path.join(
    path.dirname(targetPath),
    `.${path.basename(targetPath)}.flux-${process.pid}-${crypto.randomUUID()}.tmp`,
  )
  const mode = fs.statSync(targetPath).mode
  const handle = await fs.promises.open(tempPath, 'wx', mode)
  try {
    await handle.writeFile(encoded)
    await handle.sync()
  } finally {
    await handle.close()
  }
  try {
    await renameWithRetry(tempPath, targetPath)
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException
    const code = nodeError.code === 'EACCES' ? 'PERMISSION_DENIED' : 'IO_ERROR'
    throw new FluxFileError(code, `Failed to replace text file atomically: ${nodeError.message}`)
  }
  return { version: readText(targetPath).version }
}

export async function writeTextLegacy(filePath: string, content: string): Promise<void> {
  const resolved = path.resolve(filePath)
  if (!fs.existsSync(resolved)) {
    fs.mkdirSync(path.dirname(resolved), { recursive: true })
    fs.writeFileSync(resolved, '', 'utf8')
  }
  const snapshot = readText(resolved)
  await saveText({
    filePath: resolved,
    content,
    encoding: snapshot.encoding,
    lineEnding: snapshot.lineEnding,
    expectedVersion: snapshot.version,
  })
}

export function getFileInfo(filePath: string): FileInfo {
  const stat = fs.statSync(filePath)
  const ext = path.extname(filePath).toLowerCase()
  // Read up to 1MB for metadata (encoding detection + line count)
  const readSize = Math.min(stat.size, 1024 * 1024)
  const fd = fs.openSync(filePath, 'r')
  const buffer = Buffer.alloc(readSize)
  fs.readSync(fd, buffer, 0, readSize, 0)
  fs.closeSync(fd)

  const encoding = detectEncoding(buffer)
  const content = iconv.decode(buffer, encoding)
  const lines = content.split('\n').length

  return {
    path: filePath,
    name: path.basename(filePath),
    size: stat.size,
    lines,
    encoding,
    extension: ext,
  }
}

export function readFile(filePath: string): { content: string; encoding: string } {
  const buffer = fs.readFileSync(filePath)
  const encoding = detectEncoding(buffer)
  return {
    content: iconv.decode(buffer, encoding),
    encoding,
  }
}

export interface ReadFileLineRangeResult {
  content: string
  encoding: string
  /** 1-based inclusive */
  startLine: number
  /** 1-based inclusive */
  endLine: number
  totalLines: number
  truncated: boolean
}

/**
 * Read a line range without loading the entire file into memory (large files).
 * Files ≤512KB use an in-memory fast path.
 */
export function readFileLineRange(
  filePath: string,
  offset = 0,
  limit = READ_FILE_DEFAULT_LIMIT,
): ReadFileLineRangeResult {
  const stat = fs.statSync(filePath)
  // Small files: simpler path avoids stream overhead
  if (stat.size <= 512 * 1024) {
    const { content, encoding } = readFile(filePath)
    const lines = content.split('\n')
    const skipLines = Math.max(0, Math.floor(offset))
    const cappedLimit = Math.min(Math.max(1, limit), READ_FILE_MAX_LINES)
    let truncated = false
    const slice = lines.slice(skipLines, skipLines + cappedLimit)
    let joined = slice.join('\n')
    if (joined.length > READ_FILE_MAX_CHARS) {
      joined = joined.slice(0, READ_FILE_MAX_CHARS)
      truncated = true
    }
    if (skipLines + cappedLimit < lines.length) truncated = true
    const startLine = lines.length === 0 ? 1 : skipLines + 1
    const endLine = lines.length === 0 ? 1 : Math.min(skipLines + slice.length, lines.length)
    return {
      content: joined,
      encoding,
      startLine,
      endLine,
      totalLines: lines.length,
      truncated,
    }
  }

  // Large files: stream synchronously via readFileSync chunks is not ideal;
  // use incremental read via openSync + manual newline scan for the requested range only.
  const probeSize = Math.min(stat.size, 64 * 1024)
  const probeBuf = Buffer.alloc(probeSize)
  const fd = fs.openSync(filePath, 'r')
  fs.readSync(fd, probeBuf, 0, probeSize, 0)
  const encoding = detectEncoding(probeBuf)

  const cappedLimit = Math.min(Math.max(1, limit), READ_FILE_MAX_LINES)
  const skipLines = Math.max(0, Math.floor(offset))

  const collected: string[] = []
  let lineIndex = 0
  let charCount = 0
  let truncated = false
  let startLine = 0
  let endLine = 0
  const decoder = iconv.getDecoder(encoding)
  let carry = ''
  const chunkSize = 256 * 1024
  let pos = 0

  try {
    while (pos < stat.size) {
      const toRead = Math.min(chunkSize, stat.size - pos)
      const buf = Buffer.alloc(toRead)
      const bytesRead = fs.readSync(fd, buf, 0, toRead, pos)
      if (bytesRead === 0) break
      pos += bytesRead
      const text = carry + decoder.write(buf.subarray(0, bytesRead))
      const parts = text.split('\n')
      carry = parts.pop() ?? ''

      for (const line of parts) {
        if (lineIndex >= skipLines) {
          if (collected.length === 0) startLine = lineIndex + 1
          const nextLen = charCount + line.length + (collected.length > 0 ? 1 : 0)
          if (collected.length < cappedLimit && nextLen <= READ_FILE_MAX_CHARS) {
            collected.push(line)
            charCount = nextLen
            endLine = lineIndex + 1
          } else {
            truncated = true
          }
        }
        lineIndex++
      }

      if (truncated && collected.length >= cappedLimit) continue
      if (truncated && charCount >= READ_FILE_MAX_CHARS) continue
    }
    carry += decoder.end()
  } finally {
    fs.closeSync(fd)
  }

  // Handle trailing content after the last newline (only if non-empty)
  if (carry.length > 0) {
    const line = carry
    if (lineIndex >= skipLines) {
      if (collected.length === 0) startLine = lineIndex + 1
      const nextLen = charCount + line.length + (collected.length > 0 ? 1 : 0)
      if (collected.length < cappedLimit && nextLen <= READ_FILE_MAX_CHARS) {
        collected.push(line)
        endLine = lineIndex + 1
      } else {
        truncated = true
      }
    }
    lineIndex++
  }

  const totalLines = lineIndex
  return {
    content: collected.join('\n'),
    encoding,
    startLine: startLine || Math.min(skipLines + 1, totalLines || 1),
    endLine: endLine || startLine,
    totalLines: totalLines || 0,
    truncated,
  }
}

/**
 * Map file extension to an icon type identifier.
 * The renderer uses this to display the correct Unicode icon.
 */
export function getFileIcon(extension: string): string {
  const iconMap: Record<string, string> = {
    '.md': 'markdown',
    '.json': 'json',
    '.txt': 'text',
    '.log': 'log',
    '.csv': 'csv',
    '.xml': 'xml',
    '.yaml': 'yaml',
    '.yml': 'yaml',
    '.js': 'code',
    '.ts': 'code',
    '.tsx': 'code',
    '.jsx': 'code',
    '.py': 'code',
    '.go': 'code',
    '.rs': 'code',
    '.java': 'code',
    '.c': 'code',
    '.cpp': 'code',
    '.h': 'code',
    '.css': 'code',
    '.html': 'code',
    '.sql': 'code',
    '.sh': 'code',
    '.bat': 'code',
    '.ps1': 'code',
    '.ini': 'text',
    '.cfg': 'text',
    '.conf': 'text',
    '.env': 'text',
  }
  return iconMap[extension] || 'file'
}
