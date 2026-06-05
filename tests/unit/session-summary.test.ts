import { describe, it, expect } from 'vitest'
import {
  extractPinCandidate,
  formatSessionSummaryMarkdown,
  parseSessionSummaryMarkdown,
} from '../../src/shared/session-summary'

describe('session-summary', () => {
  it('extractPinCandidate prefers 执行摘要 section', () => {
    const content = `## 执行摘要\n\n发现 3 处 ERROR，平均延迟 723ms。\n\n## 详情\n\n更多内容…`
    expect(extractPinCandidate(content)).toContain('ERROR')
    expect(extractPinCandidate(content)).not.toContain('更多内容')
  })

  it('round-trips pinned and working summary markdown', () => {
    const data = {
      pinnedFacts: ['根因：连接池耗尽', '建议：增加 timeout'],
      workingSummary: '用户分析了 app.log，发现 ERROR 集群于 L120-L450。',
    }
    const md = formatSessionSummaryMarkdown(data)
    const parsed = parseSessionSummaryMarkdown(md)
    expect(parsed.pinnedFacts).toEqual(data.pinnedFacts)
    expect(parsed.workingSummary).toBe(data.workingSummary)
  })
})
