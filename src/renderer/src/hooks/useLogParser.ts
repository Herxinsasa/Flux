import { useMemo } from 'react'

// Supported log levels and their corresponding color tokens
const LEVEL_PATTERNS: { regex: RegExp; level: string; color: string }[] = [
  { regex: /\[?(FATAL|CRITICAL)\]?/i, level: 'fatal', color: 'var(--fatal)' },
  { regex: /\[?(ERROR|ERR|SEVERE)\]?/i, level: 'error', color: 'var(--error)' },
  { regex: /\[?(WARN|WARNING)\]?/i, level: 'warn', color: 'var(--warning)' },
  { regex: /\[?(INFO|INFORMATION|SUCCESS)\]?/i, level: 'info', color: 'var(--log-info)' },
  { regex: /\[?(DEBUG|TRACE|VERBOSE)\]?/i, level: 'debug', color: 'var(--log-debug)' },
]

export interface LogLine {
  index: number
  text: string
  level: string | null
  color: string | null
}

/**
 * Parse a single log line and extract its severity level.
 */
export function parseLogLine(line: string, index: number): LogLine {
  for (const pattern of LEVEL_PATTERNS) {
    if (pattern.regex.test(line)) {
      return { index, text: line, level: pattern.level, color: pattern.color }
    }
  }
  return { index, text: line, level: null, color: null }
}

/**
 * Parse an entire log file content into an array of LogLine objects.
 */
export function parseLogContent(content: string): LogLine[] {
  return content.split('\n').map((line, i) => parseLogLine(line, i + 1))
}

/**
 * React hook: memoised parsing of log content.
 * Re-parses only when content changes.
 */
export function useLogParser(content: string): LogLine[] {
  return useMemo(() => parseLogContent(content), [content])
}
