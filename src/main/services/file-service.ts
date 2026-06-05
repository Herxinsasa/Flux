import fs from 'fs'
import path from 'path'
import * as iconv from 'iconv-lite'
import { FileInfo } from '../../shared/types'
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
  if (buffer[0] === 0xfe && buffer[1] === 0xff) return 'utf16le'

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
  let carry = ''
  const chunkSize = 256 * 1024
  let pos = 0

  while (pos < stat.size) {
    const toRead = Math.min(chunkSize, stat.size - pos)
    const buf = Buffer.alloc(toRead)
    fs.readSync(fd, buf, 0, toRead, pos)
    pos += toRead
    const text = carry + iconv.decode(buf, encoding)
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

    if (truncated && collected.length >= cappedLimit) {
      // Still scan to EOF for total line count without storing
      continue
    }
    if (truncated && charCount >= READ_FILE_MAX_CHARS) {
      continue
    }
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

  fs.closeSync(fd)

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
