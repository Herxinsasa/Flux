import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import * as iconv from 'iconv-lite'
import {
  buildLogIndex,
  getLogIndex,
  evictLogIndex,
  readLogLines,
} from '../../src/main/services/log-index-service'
import { LOG_INDEX_SUMMARY_MAX_CHARS } from '../../src/shared/context-budget'

describe('log-index-service', () => {
  let tmpDir: string
  let logPath: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flux-log-'))
    logPath = path.join(tmpDir, 'app.log')
    const lines = [
      '[INFO] boot ok',
      '[WARN] disk low',
      '[ERROR] connection timeout at L120',
      '[ERROR] java.lang.Exception: failed',
      '[DEBUG] trace',
    ]
    fs.writeFileSync(logPath, lines.join('\n'), 'utf8')
  })

  afterEach(() => {
    evictLogIndex(logPath)
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('builds level counts and summary under 2KB', () => {
    const index = buildLogIndex(logPath)
    expect(index.totalLines).toBe(5)
    expect(index.levelCounts.error).toBeGreaterThanOrEqual(2)
    expect(index.levelCounts.warn).toBe(1)
    expect(index.summaryText.length).toBeLessThanOrEqual(LOG_INDEX_SUMMARY_MAX_CHARS + 32)
    expect(index.summaryText).toContain('ERROR')
  })

  it('caches index by mtime', () => {
    const a = getLogIndex(logPath)
    const b = getLogIndex(logPath)
    expect(a.summaryText).toBe(b.summaryText)
    evictLogIndex(logPath)
    const c = getLogIndex(logPath)
    expect(c.totalLines).toBe(a.totalLines)
  })

  it('reads random pages from indexed offsets without changing line order', () => {
    const lines = Array.from({ length: 1024 }, (_, index) => `[INFO] line-${index}`)
    fs.writeFileSync(logPath, `${lines.join('\n')}\n`, 'utf8')
    getLogIndex(logPath)

    for (const offset of [0, 127, 128, 511, 900]) {
      const page = readLogLines(logPath, offset, 13)
      expect(page.startLine).toBe(offset + 1)
      expect(page.lines).toEqual(lines.slice(offset, offset + 13))
    }
  })

  it('appends a grown file and rebuilds when the cached version is truncated', () => {
    fs.writeFileSync(logPath, '[INFO] first\n[WARN] second\n', 'utf8')
    const initial = getLogIndex(logPath)
    fs.appendFileSync(logPath, '[ERROR] third\n', 'utf8')
    fs.utimesSync(logPath, new Date(), new Date(Date.now() + 2000))
    const grown = getLogIndex(logPath)
    expect(grown.totalLines).toBe(initial.totalLines + 1)
    expect(grown.levelCounts.error).toBe(1)

    fs.writeFileSync(logPath, '[FATAL] reset\n', 'utf8')
    fs.utimesSync(logPath, new Date(), new Date(Date.now() + 4000))
    const rebuilt = getLogIndex(logPath)
    expect(rebuilt.totalLines).toBe(1)
    expect(rebuilt.levelCounts.fatal).toBe(1)
  })

  it.each(['utf16le', 'utf16be'] as const)('indexes and pages %s logs across chunk boundaries', (encoding) => {
    const lines = Array.from({ length: 20_000 }, (_, index) => {
      if (index === 3) return '[WARN] chunk boundary warning'
      if (index === 8_192) return '[ERROR] chunk boundary Exception'
      return `[INFO] line-${index}`
    })
    const body = `${lines.join('\r\n')}\r\n`
    const bom = encoding === 'utf16le' ? Buffer.from([0xff, 0xfe]) : Buffer.from([0xfe, 0xff])
    fs.writeFileSync(logPath, Buffer.concat([bom, iconv.encode(body, encoding)]))

    const index = getLogIndex(logPath)
    expect(index.totalLines).toBe(lines.length)
    expect(index.levelCounts.warn).toBe(1)
    expect(index.levelCounts.error).toBe(1)

    for (const offset of [0, 127, 128, 8_190, 12_000]) {
      const page = readLogLines(logPath, offset, 7)
      expect(page.lines).toEqual(lines.slice(offset, offset + 7))
    }
  })

  it.each([
    ['utf16le', '\u0A41\u4200'],
    ['utf16be', '\u4100\u0A42'],
  ] as const)('does not treat unaligned bytes inside real %s characters as newlines', (encoding, pseudoNewline) => {
    const firstLine = `${'A'.repeat(131_071)}${pseudoNewline} still-first-line`
    const lines = [firstLine, '[ERROR] actual second line']
    const bom = encoding === 'utf16le' ? Buffer.from([0xff, 0xfe]) : Buffer.from([0xfe, 0xff])
    fs.writeFileSync(
      logPath,
      Buffer.concat([bom, iconv.encode(lines.join('\r\n'), encoding)]),
    )

    const index = getLogIndex(logPath)
    expect(index.totalLines).toBe(2)
    expect(index.levelCounts.error).toBe(1)
    expect(readLogLines(logPath, 0, 2).lines).toEqual(lines)
    expect(readLogLines(logPath, 1, 1).lines).toEqual([lines[1]])
    expect(readLogLines(logPath, 0, 2).lines.join('')).not.toContain('\uFFFD')
  })
})
