import type { Message, ToolCallEntry } from '../stores/chatStore'
import type { PreviewChangeData } from '../hooks/useEditorChatBridge'

export function hasReportIntent(text: string): boolean {
  const t = text.toLowerCase()
  if (!t.trim()) return false
  if (t.includes('/analysis-report')) return true
  if (/(^|\s)\/[\w\u4e00-\u9fff-]*(report|报告|summary|总结)[\w\u4e00-\u9fff-]*/i.test(t)) return true
  return (
    /(导出|输出|生成|撰写|整理).{0,12}(分析报告|正式报告|markdown\s*报告|结构化报告|报告)/i.test(t) ||
    /(分析结果|结论).{0,10}(做成|整理成|写成).{0,10}(报告|文档)/i.test(t) ||
    /点击.{0,16}导出报告/i.test(t)
  )
}

export function hasProblemSummaryIntent(text: string): boolean {
  const t = text.toLowerCase()
  if (!t.trim()) return false
  if (t.includes('/problem-summary')) return true
  return /(问题总结|排查总结|故障复盘|问题沉淀|知识库条目|经验总结|总结报告)/i.test(t)
}

function hasReportDeliveryHint(text: string): boolean {
  return /点击.{0,16}导出报告/i.test(text)
}

/** 用户本轮是否要求报告类交付物 */
export function reportIntentForAiMessage(messages: Message[], aiMessageId: string): {
  reportRequested: boolean
  problemSummaryRequested: boolean
} {
  const aiIndex = messages.findIndex((m) => m.id === aiMessageId)
  const prevUser =
    aiIndex > 0
      ? [...messages.slice(0, aiIndex)].reverse().find((m) => m.role === 'user')
      : undefined
  const userText = [prevUser?.content ?? '', prevUser?.contextFootnote ?? ''].join('\n')
  const aiText = aiIndex >= 0 ? messages[aiIndex]?.content ?? '' : ''
  return {
    reportRequested: hasReportIntent(userText) || hasReportDeliveryHint(aiText),
    problemSummaryRequested: hasProblemSummaryIntent(userText),
  }
}

const THIN_META_PATTERNS = [
  /报告已(导出|保存|写入|生成)/,
  /文件路径[：:]/,
  /已导出到/,
  /你可以直接用\s*markdown\s*预览/i,
  /请点击.*导出报告/,
]

/** AI 仅回复「已导出到某路径 + 目录式 bullet」，缺少实质分析正文 */
export function isThinReportMetaResponse(text: string): boolean {
  const trimmed = text.trim()
  if (!trimmed) return true
  if (trimmed.length >= 600) return false
  if (/^#{1,3}\s/m.test(trimmed)) return false
  if (trimmed.includes('|') && trimmed.includes('---')) return false
  if (/【问题名称】|【问题表象】/.test(trimmed)) return false
  if (/🔴|🟡|🔵/.test(trimmed) && trimmed.length >= 180) return false

  const metaHits = THIN_META_PATTERNS.filter((re) => re.test(trimmed)).length
  if (metaHits >= 1 && trimmed.length < 400) return true
  if (metaHits >= 2) return true
  return false
}

function isMarkdownReportPath(filePath: string): boolean {
  return /\.(md|markdown)$/i.test(filePath)
}

function isSubstantiveMarkdown(text: string): boolean {
  const t = text.trim()
  if (t.length >= 80) return true
  if (/^#{1,3}\s/m.test(t) && t.length >= 24) return true
  if (/【问题名称】|【问题表象】/.test(t)) return true
  return false
}

function parseWriteFileInput(input: unknown): {
  filePath?: string
  content?: string
  edits?: Array<{ newText: string }>
} {
  if (!input || typeof input !== 'object') return {}
  const row = input as Record<string, unknown>
  const filePath = typeof row.filePath === 'string' ? row.filePath : undefined
  const content = typeof row.content === 'string' ? row.content : undefined
  const edits = Array.isArray(row.edits)
    ? row.edits
        .map((e) => {
          if (!e || typeof e !== 'object') return null
          const edit = e as Record<string, unknown>
          return typeof edit.newText === 'string' ? { newText: edit.newText } : null
        })
        .filter((e): e is { newText: string } => Boolean(e))
    : undefined
  return { filePath, content, edits }
}

function parseWriteFileOutput(output: unknown): string | null {
  if (output === undefined) return null
  const raw = typeof output === 'string' ? output : JSON.stringify(output)
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>
    if (typeof parsed.content === 'string' && parsed.content.trim()) {
      return parsed.content
    }
    if (Array.isArray(parsed.edits)) {
      const parts = parsed.edits
        .map((e) => {
          if (!e || typeof e !== 'object') return ''
          const edit = e as Record<string, unknown>
          return typeof edit.newText === 'string' ? edit.newText : ''
        })
        .filter(Boolean)
      if (parts.length > 0) return parts.join('\n')
    }
  } catch {
    /* not JSON */
  }
  return null
}

/** 从 write_file 工具调用或预览元数据提取 Markdown 正文（模型误用 write_file 时的兜底） */
export function extractMarkdownFromWriteFile(
  tc: ToolCallEntry,
  previewMeta?: PreviewChangeData,
): string | null {
  if (tc.name !== 'write_file') return null

  const inp = parseWriteFileInput(tc.input)
  if (inp.filePath && !isMarkdownReportPath(inp.filePath)) return null

  if (previewMeta?.content?.trim()) {
    return previewMeta.content.trim()
  }

  if (inp.content?.trim()) {
    return inp.content.trim()
  }

  if (inp.edits?.length) {
    const merged = inp.edits.map((e) => e.newText).filter(Boolean).join('\n').trim()
    if (merged) return merged
  }

  const fromOutput = parseWriteFileOutput(tc.output)
  if (fromOutput?.trim()) return fromOutput.trim()

  return null
}

export function isReportLikeWriteFile(tc: ToolCallEntry): boolean {
  if (tc.name !== 'write_file') return false
  const inp = parseWriteFileInput(tc.input)
  if (!inp.filePath || !isMarkdownReportPath(inp.filePath)) return false
  const body =
    inp.content?.trim() ||
    inp.edits?.map((e) => e.newText).join('\n').trim() ||
    parseWriteFileOutput(tc.output)?.trim() ||
    ''
  return body.length >= 120
}

export interface BuildExportReportOptions {
  problemSummaryRequested: boolean
  previewMetaByChangeId?: Map<string, PreviewChangeData>
}

/** 组装「导出报告」Markdown 正文（不含工具附录） */
export function buildExportReportContent(
  aiMessage: Message,
  opts: BuildExportReportOptions,
): string | null {
  const chatBody = aiMessage.content.trim()
  let reportBody = chatBody

  if (isThinReportMetaResponse(chatBody)) {
    let bestFallback = ''
    for (const tc of aiMessage.toolCalls ?? []) {
      const extracted = extractMarkdownFromWriteFile(
        tc,
        opts.previewMetaByChangeId?.get(tc.id),
      )
      if (extracted && extracted.length > bestFallback.length) {
        bestFallback = extracted
      }
    }
    if (bestFallback && isSubstantiveMarkdown(bestFallback)) {
      reportBody = bestFallback
    }
  }

  if (!reportBody.trim()) return null

  const lines: string[] = []
  lines.push(opts.problemSummaryRequested ? '# 问题总结' : '# 日志分析报告')
  lines.push('')
  lines.push(`> 生成时间: ${new Date().toLocaleString('zh-CN')}`)
  lines.push('')
  lines.push(reportBody)
  return lines.join('\n')
}
