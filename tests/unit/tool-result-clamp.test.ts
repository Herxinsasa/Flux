import { describe, it, expect } from 'vitest'
import { clampToolResult } from '../../src/main/agent/tool-result-clamp'
import { MAX_TOOL_CHAT_CHARS } from '../../src/shared/context-budget'

describe('tool-result-clamp', () => {
  it('clamps read_file content to chat budget while keeping meta footer', () => {
    const body = 'x'.repeat(12_000)
    const meta = '\n\n[read app.log L1-2000, total 50000 lines, truncated]'
    const out = clampToolResult('read_file', body + meta)
    expect(out.length).toBeLessThanOrEqual(MAX_TOOL_CHAT_CHARS + 50)
    expect(out).toContain('[read app.log')
  })

  it('summarizes write_file without full content body', () => {
    const raw = JSON.stringify({
      mode: 'full',
      filePath: '/tmp/out.md',
      content: '# Report\n' + 'y'.repeat(20_000),
    })
    const out = clampToolResult('write_file', raw)
    expect(out).toContain('contentChars')
    expect(out).not.toContain('y'.repeat(100))
    expect(out.length).toBeLessThanOrEqual(MAX_TOOL_CHAT_CHARS)
  })

  it('limits search_content to line budget with meta', () => {
    const lines = Array.from({ length: 500 }, (_, i) => `/a.log:${i}:ERROR`)
    const out = clampToolResult('search_content', lines.join('\n'))
    expect(out).toContain('[search')
    expect(out.split('\n').length).toBeLessThan(250)
    expect(out.length).toBeLessThanOrEqual(MAX_TOOL_CHAT_CHARS + 100)
  })

  it('clamps fetch_webpage excerpt in JSON', () => {
    const raw = JSON.stringify({
      url: 'https://example.com',
      excerpt: 'z'.repeat(20_000),
    })
    const out = clampToolResult('fetch_webpage', raw)
    expect(out.length).toBeLessThanOrEqual(MAX_TOOL_CHAT_CHARS + 200)
    expect(out).toContain('truncated')
  })

  it('passes through small tool results unchanged', () => {
    const small = 'ok'
    expect(clampToolResult('get_file_info', small)).toBe(small)
  })
})
