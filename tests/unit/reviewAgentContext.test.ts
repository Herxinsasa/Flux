import { describe, expect, it } from 'vitest'
import type { ReviewComment } from '../../src/shared/review'
import {
  buildReviewAgentContext,
  shouldInjectReviewContext,
} from '../../src/renderer/src/utils/reviewAgentContext'

function comment(status: 'open' | 'resolved', body: string): ReviewComment {
  return {
    id: body,
    anchor: { start: 0, end: 4, quote: '原文', prefix: '', suffix: '', sourceHash: 'hash' },
    body,
    author: 'user',
    status,
    anchorStatus: 'valid',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

describe('review agent context', () => {
  it('activates for review requests and review skills', () => {
    expect(shouldInjectReviewContext('请根据批注修改当前文件', [])).toBe(true)
    expect(shouldInjectReviewContext('修改当前文件', ['评审处理'])).toBe(true)
    expect(shouldInjectReviewContext('总结当前文件', [])).toBe(false)
  })

  it('injects only unresolved comments and protects the sidecar', () => {
    const context = buildReviewAgentContext('C:\\docs\\note.md', [
      comment('open', '补充结论'),
      comment('resolved', '已处理意见'),
    ])
    expect(context).toContain('补充结论')
    expect(context).not.toContain('已处理意见')
    expect(context).toContain('不要修改 .review.json')
    expect(context).toContain('write_file')
  })
})
