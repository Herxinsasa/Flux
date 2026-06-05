import { describe, it, expect } from 'vitest'
import {
  MAX_HISTORY_TOTAL_CHARS,
  MAX_REQUEST_INPUT_CHARS,
  LARGE_FILE_NO_INJECT_BYTES,
  assembleContext,
  headTailTruncate,
  truncateHistory,
  estimateInputChars,
} from '../../src/shared/context-budget'

describe('context-budget', () => {
  it('truncateHistory drops oldest when over char cap', () => {
    const history = Array.from({ length: 10 }, () => ({
      role: 'user' as const,
      content: 'x'.repeat(20_000),
    }))
    const { messages, warnings } = truncateHistory(history)
    expect(messages.length).toBeLessThan(history.length)
    expect(messages.length).toBeGreaterThanOrEqual(8)
    expect(warnings.length).toBeGreaterThan(0)
  })

  it('strips reasoning except last 2 assistant messages', () => {
    const history = [
      { role: 'user' as const, content: 'q1' },
      { role: 'assistant' as const, content: 'a1', reasoningContent: 'r1' },
      { role: 'user' as const, content: 'q2' },
      { role: 'assistant' as const, content: 'a2', reasoningContent: 'r2' },
      { role: 'user' as const, content: 'q3' },
      { role: 'assistant' as const, content: 'a3', reasoningContent: 'r3' },
    ]
    const { messages } = truncateHistory(history)
    expect(messages[1].reasoningContent).toBeUndefined()
    expect(messages[3].reasoningContent).toBe('r2')
    expect(messages[5].reasoningContent).toBe('r3')
  })

  it('does not inject content for files larger than 512KB', () => {
    const big = 'a'.repeat(100)
    const result = assembleContext({
      baseSystemPrompt: 'base',
      userMessage: 'hi',
      history: [],
      openFiles: [{ path: '/tmp/app.log', content: big, sizeBytes: LARGE_FILE_NO_INJECT_BYTES + 1 }],
    })
    expect(result.openFiles[0].injectContent).toBeUndefined()
    expect(result.openFiles[0].metadataLine).toContain('app.log')
    expect(result.warnings.some((w) => w.includes('大文件'))).toBe(true)
  })

  it('headTailTruncate keeps head and tail', () => {
    const text = 'H'.repeat(20_000) + 'M'.repeat(5_000) + 'T'.repeat(20_000)
    const out = headTailTruncate(text, 100, 100)
    expect(out.startsWith('H'.repeat(100))).toBe(true)
    expect(out.endsWith('T'.repeat(100))).toBe(true)
    expect(out).toContain('truncated')
  })

  it('estimateInputChars stays under hard cap for typical assembly', () => {
    const result = assembleContext({
      baseSystemPrompt: 'rules'.repeat(100),
      userMessage: 'analyze log',
      history: [{ role: 'user', content: 'hello' }],
      openFiles: [],
    })
    expect(result.estimate.total).toBeLessThanOrEqual(MAX_REQUEST_INPUT_CHARS)
    expect(result.estimate.level).toBe('ok')
  })

  it('estimateInputChars reports warn level near threshold', () => {
    const est = estimateInputChars({
      system: 'x'.repeat(200_000),
      preface: 'y'.repeat(100_000),
      userMessage: 'z',
    })
    expect(est.level).toBe('warn')
  })
})
