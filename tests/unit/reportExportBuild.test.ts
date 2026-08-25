import { describe, it, expect } from 'vitest'
import {
  buildExportReportContent,
  extractMarkdownFromWriteFile,
  isThinReportMetaResponse,
  reportIntentForAiMessage,
} from '../../src/renderer/src/utils/reportExportBuild'
import type { Message } from '../../src/renderer/src/stores/chatStore'

describe('reportExportBuild', () => {
  it('detects thin meta-only AI replies', () => {
    const thin = `根据分析结果，为您生成完整报告文件。报告已导出到桌面：节拍统计报告.md
文件路径：C:\\Users\\test\\Desktop\\report.md
报告包含：总体概览、明细表、优化建议`
    expect(isThinReportMetaResponse(thin)).toBe(true)
    expect(isThinReportMetaResponse('## 执行摘要\n\n18 次循环，平均 723ms…')).toBe(false)
  })

  it('extracts markdown from write_file tool input', () => {
    const tc = {
      id: '1',
      name: 'write_file',
      input: {
        filePath: 'C:\\Users\\test\\Desktop\\report.md',
        content: '# 日志分析报告\n\n## 执行摘要\n\n18 次循环。',
      },
    }
    expect(extractMarkdownFromWriteFile(tc)).toContain('执行摘要')
  })

  it('builds export from chat when substantive', () => {
    const aiMessage: Message = {
      id: 'ai-1',
      role: 'ai',
      content: '## 执行摘要\n\n平均 723ms，无超 1s 循环。\n\n## 建议\n\n优化匹配环节。',
    }
    const out = buildExportReportContent(aiMessage, { problemSummaryRequested: false })
    expect(out).toContain('# 日志分析报告')
    expect(out).toContain('执行摘要')
    expect(out).not.toContain('write_file')
  })

  it('falls back to write_file body when chat is thin meta', () => {
    const aiMessage: Message = {
      id: 'ai-1',
      role: 'ai',
      content: '报告已导出到桌面，文件路径：C:\\test\\report.md',
      toolCalls: [
        {
          id: 'w1',
          name: 'write_file',
          input: {
            filePath: 'C:\\test\\report.md',
            content: '## 执行摘要\n\n18 次循环，平均 723ms。',
          },
        },
      ],
    }
    const out = buildExportReportContent(aiMessage, { problemSummaryRequested: false })
    expect(out).toContain('18 次循环')
    expect(out).not.toContain('write_file')
  })

  it('resolves report intent from preceding user message', () => {
    const messages: Message[] = [
      { id: 'u1', role: 'user', content: '请生成分析报告' },
      { id: 'a1', role: 'ai', content: '## 摘要\n\n…' },
    ]
    expect(reportIntentForAiMessage(messages, 'a1').reportRequested).toBe(true)
  })

  it('keeps export available when a report skill supplies the delivery hint', () => {
    const messages: Message[] = [
      { id: 'u1', role: 'user', content: '分析这些问题', contextFootnote: '/技术评审报告' },
      { id: 'a1', role: 'ai', content: '## 结论\n\n以上报告可直接点击下方「导出报告」按钮保存。' },
    ]
    expect(reportIntentForAiMessage(messages, 'a1').reportRequested).toBe(true)
  })

  it('does not treat an ordinary AI problem summary as a requested export', () => {
    const messages: Message[] = [
      { id: 'u1', role: 'user', content: '分析这些问题' },
      { id: 'a1', role: 'ai', content: '## 问题总结\n\n这里是分析结论。' },
    ]
    expect(reportIntentForAiMessage(messages, 'a1')).toEqual({
      reportRequested: false,
      problemSummaryRequested: false,
    })
  })
})
