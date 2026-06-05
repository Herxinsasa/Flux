import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { buildLogIndex, getLogIndex, evictLogIndex } from '../../src/main/services/log-index-service'
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
})
