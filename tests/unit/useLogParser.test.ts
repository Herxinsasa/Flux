import { describe, it, expect } from 'vitest'
import { parseLogLine, parseLogContent } from '../../src/renderer/src/hooks/useLogParser'

describe('parseLogLine', () => {
  it("recognizes [ERROR] level", () => {
    const result = parseLogLine('[ERROR] Connection refused', 1)
    expect(result.level).toBe('error')
    expect(result.index).toBe(1)
    expect(result.text).toBe('[ERROR] Connection refused')
    expect(result.color).toBeTruthy()
  })

  it("recognizes [ERR] shorthand", () => {
    const result = parseLogLine('[ERR] Timeout reached', 2)
    expect(result.level).toBe('error')
  })

  it("recognizes [SEVERE] level", () => {
    const result = parseLogLine('[SEVERE] Database connection pool exhausted', 3)
    expect(result.level).toBe('error')
  })

  it("recognizes [WARN] level", () => {
    const result = parseLogLine('[WARN] Disk space low', 4)
    expect(result.level).toBe('warn')
  })

  it("recognizes [WARNING] level", () => {
    const result = parseLogLine('[WARNING] Deprecated API usage', 5)
    expect(result.level).toBe('warn')
  })

  it("recognizes [INFO] level", () => {
    const result = parseLogLine('[INFO] Server started on port 3000', 6)
    expect(result.level).toBe('info')
  })

  it("recognizes [INFORMATION] level", () => {
    const result = parseLogLine('[INFORMATION] Config loaded', 7)
    expect(result.level).toBe('info')
  })

  it("recognizes [SUCCESS] level", () => {
    const result = parseLogLine('[SUCCESS] Build completed', 8)
    expect(result.level).toBe('info')
  })

  it("recognizes [DEBUG] level", () => {
    const result = parseLogLine('[DEBUG] Variable x = 42', 9)
    expect(result.level).toBe('debug')
  })

  it("recognizes [TRACE] level", () => {
    const result = parseLogLine('[TRACE] Entering function foo()', 10)
    expect(result.level).toBe('debug')
  })

  it("recognizes [FATAL] level", () => {
    const result = parseLogLine('[FATAL] Out of memory', 11)
    expect(result.level).toBe('fatal')
  })

  it("recognizes [CRITICAL] level", () => {
    const result = parseLogLine('[CRITICAL] Database corruption detected', 12)
    expect(result.level).toBe('fatal')
  })

  it('is case-insensitive', () => {
    expect(parseLogLine('[error] something failed', 1).level).toBe('error')
    expect(parseLogLine('[Error] something failed', 1).level).toBe('error')
    expect(parseLogLine('[Warn] disk warning', 1).level).toBe('warn')
    expect(parseLogLine('[Info] started', 1).level).toBe('info')
  })

  it('recognizes levels without brackets', () => {
    expect(parseLogLine('ERROR: file not found', 1).level).toBe('error')
    expect(parseLogLine('WARN: retry attempt 3', 1).level).toBe('warn')
    expect(parseLogLine('INFO: processing...', 1).level).toBe('info')
  })

  it('returns null level for plain text lines', () => {
    const result = parseLogLine('This is just a regular log line', 42)
    expect(result.level).toBeNull()
    expect(result.color).toBeNull()
    expect(result.index).toBe(42)
    expect(result.text).toBe('This is just a regular log line')
  })

  it('returns null level for empty lines', () => {
    const result = parseLogLine('', 0)
    expect(result.level).toBeNull()
  })
})

describe('parseLogContent', () => {
  it('splits content by newline and parses each line', () => {
    const content = 'line1\n[ERROR] line2\nline3'
    const results = parseLogContent(content)
    expect(results).toHaveLength(3)
    expect(results[0].index).toBe(1)
    expect(results[0].level).toBeNull()
    expect(results[1].index).toBe(2)
    expect(results[1].level).toBe('error')
    expect(results[2].index).toBe(3)
    expect(results[2].level).toBeNull()
  })

  it('handles single-line content', () => {
    const results = parseLogContent('[INFO] Server running')
    expect(results).toHaveLength(1)
    expect(results[0].level).toBe('info')
    expect(results[0].index).toBe(1)
  })

  it('handles empty string', () => {
    const results = parseLogContent('')
    expect(results).toHaveLength(1)
    expect(results[0].text).toBe('')
    expect(results[0].level).toBeNull()
  })

  it('handles mixed log levels', () => {
    const content = [
      '[INFO] App start',
      '[DEBUG] Config loaded',
      '[WARN] Deprecated option',
      '[ERROR] Crash',
      '[FATAL] Shutdown',
    ].join('\n')
    const results = parseLogContent(content)
    expect(results.map((r) => r.level)).toEqual([
      'info',
      'debug',
      'warn',
      'error',
      'fatal',
    ])
  })
})
