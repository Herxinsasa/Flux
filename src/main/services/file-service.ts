import fs from 'fs'
import path from 'path'
import * as iconv from 'iconv-lite'
import { FileInfo } from '../../shared/types'

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
