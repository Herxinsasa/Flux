import { describe, it, expect } from 'vitest'
import {
  buildWorkingSummary,
  compressSessionHistory,
  historyCharCount,
  selectHotHistory,
  shouldAutoCompress,
} from '../../src/shared/history-compress'
import { MAX_HISTORY_HOT_MESSAGES } from '../../src/shared/context-budget'

describe('history-compress', () => {
  it('selectHotHistory keeps last N messages', () => {
    const msgs = Array.from({ length: 20 }, (_, i) => ({
      id: String(i),
      role: (i % 2 === 0 ? 'user' : 'ai') as 'user' | 'ai',
      content: `m${i}`,
    }))
    const hot = selectHotHistory(msgs)
    expect(hot).toHaveLength(MAX_HISTORY_HOT_MESSAGES)
    expect(hot[0]?.content).toBe('m4')
  })

  it('buildWorkingSummary extracts headings and first question', () => {
    const msgs = [
      { id: '0', role: 'user' as const, content: '分析 app.log 里的 ERROR' },
      ...Array.from({ length: 18 }, (_, i) => ({
        id: String(i + 1),
        role: (i % 2 === 0 ? 'ai' : 'user') as 'user' | 'ai',
        content: i === 0 ? '## 执行摘要\n\n发现 **3 处 ERROR** 于 L120-L450' : `follow-up ${i}`,
      })),
    ]
    const summary = buildWorkingSummary(msgs)
    expect(summary).toContain('用户首问')
    expect(summary).toContain('ERROR')
  })

  it('compressSessionHistory produces summary and hot layer', () => {
    const msgs = Array.from({ length: 24 }, (_, i) => ({
      id: String(i),
      role: (i % 2 === 0 ? 'user' : 'ai') as 'user' | 'ai',
      content: `msg ${i}`,
    }))
    const { workingSummary, hotMessages, compressedUpToMessageId } = compressSessionHistory(msgs)
    expect(workingSummary.length).toBeGreaterThan(0)
    expect(hotMessages.length).toBe(MAX_HISTORY_HOT_MESSAGES)
    expect(compressedUpToMessageId).toBeTruthy()
  })

  it('shouldAutoCompress when message count exceeds threshold', () => {
    const msgs = Array.from({ length: 25 }, (_, i) => ({
      id: String(i),
      role: 'user' as const,
      content: 'x',
    }))
    expect(shouldAutoCompress(msgs, true)).toBe(true)
    expect(shouldAutoCompress(msgs, false)).toBe(false)
  })

  it('shouldAutoCompress when history chars exceed threshold', () => {
    const msgs = [{ id: '1', role: 'user' as const, content: 'y'.repeat(130_000) }]
    expect(shouldAutoCompress(msgs, true)).toBe(true)
    expect(historyCharCount(msgs)).toBeGreaterThan(126_000)
  })
})
