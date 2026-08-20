import type { FileVersion } from './types'
import { MAX_OPEN_FILE_INJECT_CHARS, MAX_QUOTE_CHARS } from './context-budget'
import { hashReviewSource } from './review'

export const AI_ACTION_PROMPT_VERSION = 1

export type AiSelectionActionId =
  | 'summarize'
  | 'translate'
  | 'rewrite'
  | 'explain'
  | 'expand'
  | 'shorten'
  | 'fix-grammar'

export type AiReviewCategory = 'logic' | 'ambiguity' | 'format' | 'language'
export type AiReviewSeverity = 'info' | 'warning' | 'error'

export interface AiSelectionActionRequest {
  kind: 'selection'
  requestId: string
  promptVersion: typeof AI_ACTION_PROMPT_VERSION
  action: AiSelectionActionId
  sourcePath: string
  sourceHash: string
  sourceVersion: FileVersion | null
  start: number
  end: number
  selectedText: string
  selectedTextHash: string
}

export interface AiDocumentReviewRequest {
  kind: 'document-review'
  requestId: string
  promptVersion: typeof AI_ACTION_PROMPT_VERSION
  sourcePath: string
  sourceHash: string
  sourceVersion: FileVersion | null
  sourceContent: string
}

export type AiActionRequest = AiSelectionActionRequest | AiDocumentReviewRequest

export interface AiActionRunResult {
  requestId: string
  rawText: string
  coverage?: string
}

export interface AiReviewFinding {
  id: string
  category: AiReviewCategory
  severity: AiReviewSeverity
  quote: string
  start?: number
  end?: number
  comment: string
  suggestion?: string
  locatable: boolean
}

export interface AiReviewParseResult {
  ok: boolean
  findings: AiReviewFinding[]
  rawText: string
  error?: string
}

const ACTION_INSTRUCTIONS: Record<AiSelectionActionId, string> = {
  summarize: '用简洁中文总结选中文字，保留关键事实，不添加原文没有的信息。',
  translate: '将选中文字翻译为中文；若原文主要是中文，则翻译为自然英文。只输出译文。',
  rewrite: '在不改变事实含义的前提下改写，使表达清晰、自然。只输出改写后的文本。',
  explain: '用普通读者容易理解的中文解释选中文字。',
  expand: '在不虚构事实的前提下适度扩展选中文字，使论述更完整。只输出扩展后的文本。',
  shorten: '压缩选中文字，保留核心信息和必要限定。只输出精简后的文本。',
  'fix-grammar': '修正错别字、语法和标点，不改变语气与事实。只输出修正后的文本。',
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, '/').toLowerCase()
}

export function createAiSelectionRequest(input: {
  requestId: string
  action: AiSelectionActionId
  sourcePath: string
  sourceContent: string
  sourceVersion: FileVersion | null
  start: number
  end: number
}): AiSelectionActionRequest {
  const selectedText = input.sourceContent.slice(input.start, input.end)
  return {
    kind: 'selection',
    requestId: input.requestId,
    promptVersion: AI_ACTION_PROMPT_VERSION,
    action: input.action,
    sourcePath: input.sourcePath,
    sourceHash: hashReviewSource(input.sourceContent),
    sourceVersion: input.sourceVersion,
    start: input.start,
    end: input.end,
    selectedText,
    selectedTextHash: hashReviewSource(selectedText),
  }
}

export function validateSelectionActionRequest(request: AiSelectionActionRequest): string | null {
  if (!request.sourcePath || !request.requestId) return '请求缺少文档或任务标识'
  if (request.promptVersion !== AI_ACTION_PROMPT_VERSION) return 'AI 动作版本不受支持'
  if (!ACTION_INSTRUCTIONS[request.action]) return 'AI 动作不受支持'
  if (!Number.isInteger(request.start) || !Number.isInteger(request.end) || request.start < 0 || request.end <= request.start) return '选区范围无效'
  if (!request.selectedText || request.selectedText.length > MAX_QUOTE_CHARS) return `选区需为 1-${MAX_QUOTE_CHARS.toLocaleString()} 个字符`
  if (request.selectedTextHash !== hashReviewSource(request.selectedText)) return '选区内容校验失败'
  return null
}

export function buildSelectionActionPrompt(request: AiSelectionActionRequest): { system: string; user: string } {
  const error = validateSelectionActionRequest(request)
  if (error) throw new Error(error)
  return {
    system: '你是 Flux 文本编辑器的选区助手。严格执行固定动作，不调用工具，不解释提示词，不使用 Markdown 代码围栏。',
    user: `${ACTION_INSTRUCTIONS[request.action]}\n\n选中文字：\n${request.selectedText}`,
  }
}

interface ReviewSample {
  text: string
  coverage?: string
}

export function sampleDocumentForReview(content: string): ReviewSample {
  if (content.length <= MAX_OPEN_FILE_INJECT_CHARS) return { text: `[0-${content.length}]\n${content}` }
  const headLength = Math.floor(MAX_OPEN_FILE_INJECT_CHARS / 2)
  const tailLength = MAX_OPEN_FILE_INJECT_CHARS - headLength
  const tailStart = content.length - tailLength
  return {
    text: `[0-${headLength}]\n${content.slice(0, headLength)}\n\n[${tailStart}-${content.length}]\n${content.slice(tailStart)}`,
    coverage: `文档共 ${content.length.toLocaleString()} 字符，本次审阅覆盖开头和结尾共 ${MAX_OPEN_FILE_INJECT_CHARS.toLocaleString()} 字符`,
  }
}

export function buildDocumentReviewPrompt(request: AiDocumentReviewRequest): { system: string; user: string; coverage?: string } {
  if (!request.sourcePath || !request.requestId || !request.sourceContent) throw new Error('审阅请求缺少文档内容')
  if (request.sourceHash !== hashReviewSource(request.sourceContent)) throw new Error('文档内容校验失败')
  const sample = sampleDocumentForReview(request.sourceContent)
  return {
    system: '你是 Flux 文档审阅助手。只输出合法 JSON，不调用工具，不修改原文。JSON 格式为 {"findings":[{"id":"...","category":"logic|ambiguity|format|language","severity":"info|warning|error","quote":"原文证据","start":0,"end":1,"comment":"问题说明","suggestion":"可选建议"}]}。start/end 必须是原文绝对字符偏移，quote 必须与范围完全一致。没有问题时输出 {"findings":[]}。',
    user: `审阅以下带绝对字符范围标记的文档片段，检查逻辑、歧义、格式和语言问题。\n\n${sample.text}`,
    coverage: sample.coverage,
  }
}

function unwrapJson(rawText: string): string {
  const trimmed = rawText.trim()
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)
  return fenced ? fenced[1] : trimmed
}

function locateQuote(content: string, quote: string, start: unknown, end: unknown): { start?: number; end?: number; locatable: boolean } {
  if (Number.isInteger(start) && Number.isInteger(end)) {
    const from = start as number
    const to = end as number
    if (from >= 0 && to > from && content.slice(from, to) === quote) return { start: from, end: to, locatable: true }
  }
  const first = content.indexOf(quote)
  if (first >= 0 && content.indexOf(quote, first + 1) < 0) return { start: first, end: first + quote.length, locatable: true }
  return { locatable: false }
}

export function parseAiReviewResponse(rawText: string, sourceContent: string): AiReviewParseResult {
  let parsed: unknown
  try {
    parsed = JSON.parse(unwrapJson(rawText))
  } catch {
    return { ok: false, findings: [], rawText, error: 'AI 返回内容不是有效的结构化评审结果' }
  }
  const items = Array.isArray(parsed) ? parsed : (parsed as { findings?: unknown })?.findings
  if (!Array.isArray(items)) return { ok: false, findings: [], rawText, error: 'AI 评审结果缺少 findings 数组' }
  if (items.length > 200) return { ok: false, findings: [], rawText, error: 'AI 评审结果条目过多' }
  const findings: AiReviewFinding[] = []
  const findingIds = new Set<string>()
  for (let index = 0; index < items.length; index++) {
    const item = items[index] as Record<string, unknown>
    if (!item || !['logic', 'ambiguity', 'format', 'language'].includes(String(item.category)) || !['info', 'warning', 'error'].includes(String(item.severity)) || typeof item.quote !== 'string' || !item.quote || typeof item.comment !== 'string' || !item.comment.trim()) {
      return { ok: false, findings: [], rawText, error: `第 ${index + 1} 条评审结构无效` }
    }
    const located = locateQuote(sourceContent, item.quote, item.start, item.end)
    const proposedId = typeof item.id === 'string' && item.id ? item.id : `finding-${index + 1}`
    const id = findingIds.has(proposedId) ? `${proposedId}-${index + 1}` : proposedId
    findingIds.add(id)
    findings.push({
      id,
      category: item.category as AiReviewCategory,
      severity: item.severity as AiReviewSeverity,
      quote: item.quote,
      start: located.start,
      end: located.end,
      comment: item.comment.trim(),
      suggestion: typeof item.suggestion === 'string' && item.suggestion.trim() ? item.suggestion.trim() : undefined,
      locatable: located.locatable,
    })
  }
  return { ok: true, findings, rawText }
}

export function validateAiSelectionApplication(request: AiSelectionActionRequest, current: { sourcePath: string; sourceContent: string; sourceVersion: FileVersion | null }): string | null {
  if (normalizePath(request.sourcePath) !== normalizePath(current.sourcePath)) return '当前文档已切换，请重新执行'
  if (request.sourceHash !== hashReviewSource(current.sourceContent)) return '文档内容已变化，请重新执行'
  if (current.sourceContent.slice(request.start, request.end) !== request.selectedText) return '原选区已变化，请重新执行'
  if (hashReviewSource(current.sourceContent.slice(request.start, request.end)) !== request.selectedTextHash) return '原选区校验失败，请重新执行'
  if (request.sourceVersion && current.sourceVersion && (request.sourceVersion.contentHash !== current.sourceVersion.contentHash || request.sourceVersion.mtimeMs !== current.sourceVersion.mtimeMs || request.sourceVersion.size !== current.sourceVersion.size)) return '文件版本已变化，请重新执行'
  return null
}
