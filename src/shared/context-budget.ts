/**
 * Flux context budget — single source of truth (standard profile ≈ 128K model window).
 * Main + renderer import constants and pure helpers from here; no magic numbers elsewhere.
 */

// ---------------------------------------------------------------------------
// Profile: standard (128K tokens, input hard cap ~360K chars)
// ---------------------------------------------------------------------------

export const MAX_REQUEST_INPUT_CHARS = 320_000
export const WARN_INPUT_CHARS = 256_000

/** Auto-compress levels based on input usage percentage */
export const AUTO_COMPRESS_SOFT_PCT = 75
export const AUTO_COMPRESS_HARD_PCT = 85
export const AUTO_COMPRESS_BLOCK_PCT = 95

export const MAX_HISTORY_MESSAGES = 24
export const MAX_HISTORY_TOTAL_CHARS = 140_000
export const MAX_HISTORY_MIN_MESSAGES = 8
export const MAX_SINGLE_MESSAGE_CHARS = 40_000
export const MAX_REASONING_CHARS = 24_000
/** Only the last N assistant messages retain reasoningContent */
export const MAX_REASONING_ASSISTANT_COUNT = 2

export const MAX_SYSTEM_TOTAL_CHARS = 64_000
export const MAX_SYSTEM_BASE_CHARS = 8_000
export const MAX_SKILL_BODY_CHARS = 56_000

export const MAX_OPEN_FILE_INJECT_CHARS = 24_000
export const MAX_OPEN_FILE_HEAD_CHARS = 12_000
export const MAX_OPEN_FILE_TAIL_CHARS = 12_000
export const LARGE_FILE_NO_INJECT_BYTES = 512 * 1024

export const MAX_PREFACE_TOTAL_CHARS = 48_000
export const MAX_PREFACE_SINGLE_CHARS = 24_000
export const MAX_USER_MESSAGE_CHARS = 16_000
export const MAX_QUOTE_CHARS = 8_000

export const MAX_TOOL_CHAT_CHARS = 8_000
export const MAX_TOOL_IPC_CHARS = 4_000

export const READ_FILE_DEFAULT_LIMIT = 2_000
export const READ_FILE_MAX_CHARS = 80_000
export const READ_FILE_MAX_LINES = 5_000
export const SEARCH_CONTENT_MAX_LINES = 2_000

/** CodeMirror can keep medium text files virtualized; beyond this we retain the sampled safety path. */
export const EDITOR_LARGE_FILE_BYTES = 16 * 1024 * 1024
/** Rich Markdown parsing is substantially heavier than source editing. */
export const EDITOR_RICH_MARKDOWN_MAX_CHARS = 1_500_000
export const EDITOR_SAMPLE_LINES = 2_000

/** P2: log index summary injected into AI context for large .log files */
export const LOG_INDEX_SUMMARY_MAX_CHARS = 2_048
export const LOG_INDEX_MAX_PATTERN_LINES = 500

/** P1: UI storage caps (separate from API budget) */
export const MAX_UI_MESSAGES = 80
export const MAX_UI_TOOL_OUTPUT_CHARS = 512

/** P1: session compression */
export const WORKING_SUMMARY_MAX_CHARS = 3_000
export const MAX_PINNED_FACTS_CHARS = 1_000
export const MAX_PINNED_FACT_COUNT = 10
export const MAX_PINNED_FACT_CHARS = 200
export const MAX_HISTORY_HOT_MESSAGES = 16
export const AUTO_COMPRESS_HISTORY_CHARS = 126_000
export const AUTO_COMPRESS_MESSAGE_COUNT = 20

export const CHARS_PER_TOKEN_ESTIMATE = 3

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BudgetChatMessage {
  role: 'user' | 'assistant' | 'tool'
  content: string
  reasoningContent?: string
  toolCallId?: string
  toolName?: string
  input?: unknown
}

export interface OpenFileContext {
  path: string
  content?: string
  selectedText?: string
  /** Filled by main process via getFileInfo when absent */
  sizeBytes?: number
  lines?: number
  encoding?: string
  /** P2: log index summary for large .log (main process) */
  indexSummary?: string
}

export interface ContextBreakdown {
  system: number
  preface: number
  history: number
  userMessage: number
  openFiles: number
}

export type ContextLevel = 'ok' | 'warn' | 'over'

export interface ContextEstimateResult {
  breakdown: ContextBreakdown
  total: number
  tokenEstimate: number
  level: ContextLevel
}

export interface AssembleContextInput {
  baseSystemPrompt: string
  /** Extra skill body appended to system (after base rules) */
  skillSystemSuffix?: string
  /** P1: cold-layer conversation summary */
  contextSummary?: string
  /** P3 prep: pinned facts (≤1KB total) */
  pinnedFacts?: string[]
  preface?: string
  userMessage: string
  history: BudgetChatMessage[]
  openFiles: OpenFileContext[]
}

export interface ProcessedOpenFile {
  path: string
  selectedText?: string
  /** Inject into system prompt; undefined = metadata-only */
  injectContent?: string
  metadataLine?: string
}

export interface AssembleContextResult {
  system: string
  preface: string
  userMessage: string
  history: BudgetChatMessage[]
  openFiles: ProcessedOpenFile[]
  warnings: string[]
  estimate: ContextEstimateResult
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function charsToTokenEstimate(chars: number): number {
  return Math.ceil(chars / CHARS_PER_TOKEN_ESTIMATE)
}

export function contextLevel(total: number): ContextLevel {
  if (total > MAX_REQUEST_INPUT_CHARS) return 'over'
  if (total >= WARN_INPUT_CHARS) return 'warn'
  return 'ok'
}

function messageCharLen(m: BudgetChatMessage): number {
  return m.content.length + (m.reasoningContent?.length ?? 0)
}

export function headTailTruncate(
  text: string,
  headChars = MAX_OPEN_FILE_HEAD_CHARS,
  tailChars = MAX_OPEN_FILE_TAIL_CHARS,
): string {
  if (text.length <= headChars + tailChars) return text
  const head = text.slice(0, headChars)
  const tail = text.slice(-tailChars)
  return `${head}\n\n… [truncated ${text.length - headChars - tailChars} chars] …\n\n${tail}`
}

export function formatLargeFileMetadata(f: OpenFileContext): string {
  const sizeMb = f.sizeBytes != null ? (f.sizeBytes / (1024 * 1024)).toFixed(1) : '?'
  const lines = f.lines != null ? f.lines.toLocaleString() : '?'
  const enc = f.encoding ?? 'utf-8'
  return `File: ${f.path} | ${sizeMb}MB | ~${lines} lines | ${enc}\nUse search_content then read_file(offset, limit). Do not assume full file in context.`
}

export function clampText(
  text: string,
  maxChars: number,
  suffix = '\n\n… [context truncated]',
): { text: string; truncated: boolean } {
  if (text.length <= maxChars) return { text, truncated: false }
  return { text: text.slice(0, maxChars) + suffix, truncated: true }
}

export function clampPreface(preface: string | undefined): { text: string; warnings: string[] } {
  const warnings: string[] = []
  if (!preface?.trim()) return { text: '', warnings }

  let text = preface.trim()
  if (text.length > MAX_PREFACE_TOTAL_CHARS) {
    text = text.slice(0, MAX_PREFACE_TOTAL_CHARS) + '\n\n… [preface truncated to budget]'
    warnings.push(`引用/附件内容已截断至 ${MAX_PREFACE_TOTAL_CHARS.toLocaleString()} 字符上限`)
  }
  return { text, warnings }
}

export function clampUserMessage(message: string): { text: string; warnings: string[] } {
  const warnings: string[] = []
  const { text, truncated } = clampText(message, MAX_USER_MESSAGE_CHARS)
  if (truncated) {
    warnings.push(`用户消息已截断至 ${MAX_USER_MESSAGE_CHARS.toLocaleString()} 字符上限`)
  }
  return { text, warnings }
}

function estimateUtf8Bytes(text: string): number {
  if (typeof TextEncoder !== 'undefined') {
    return new TextEncoder().encode(text).length
  }
  return text.length
}

export function processOpenFilesForInjection(
  openFiles: OpenFileContext[],
): { files: ProcessedOpenFile[]; warnings: string[] } {
  const warnings: string[] = []
  const files: ProcessedOpenFile[] = []

  for (const f of openFiles) {
    const size = f.sizeBytes ?? (f.content != null ? estimateUtf8Bytes(f.content) : 0)
    const meta = formatLargeFileMetadata({ ...f, sizeBytes: size })

    if (size > LARGE_FILE_NO_INJECT_BYTES) {
      if (f.indexSummary?.trim()) {
        let summary = f.indexSummary.trim()
        if (summary.length > LOG_INDEX_SUMMARY_MAX_CHARS) {
          summary = summary.slice(0, LOG_INDEX_SUMMARY_MAX_CHARS) + '\n… [index truncated]'
        }
        files.push({
          path: f.path,
          selectedText: f.selectedText,
          injectContent: summary,
          metadataLine: `${meta}\n(Log index summary — use search_content / read_file for details.)`,
        })
        warnings.push(`大 log 已注入索引摘要：${f.path}`)
      } else {
        files.push({
          path: f.path,
          selectedText: f.selectedText,
          metadataLine: meta,
        })
        warnings.push(`大文件未注入全文：${f.path}（>${(LARGE_FILE_NO_INJECT_BYTES / 1024).toFixed(0)}KB）`)
      }
      continue
    }

    if (f.content !== undefined && f.content !== '') {
      let body = f.content
      if (body.length > MAX_OPEN_FILE_INJECT_CHARS) {
        body = headTailTruncate(body)
        warnings.push(`文件内容已 head/tail 截断：${f.path}`)
      }
      files.push({
        path: f.path,
        selectedText: f.selectedText,
        injectContent: body,
      })
    } else {
      files.push({
        path: f.path,
        selectedText: f.selectedText,
        metadataLine: meta,
      })
    }
  }

  return { files, warnings }
}

export function buildOpenFilesSystemSection(processed: ProcessedOpenFile[]): string {
  if (processed.length === 0) return ''

  const parts: string[] = [
    '',
    'Currently focused preview file (editor — content included when available):',
  ]

  for (const f of processed) {
    parts.push(`- ${f.path}`)
    if (f.selectedText) {
      parts.push(`  Selected text in active tab: """${f.selectedText}"""`)
    }
    if (f.injectContent !== undefined) {
      parts.push(`  Full content:\n\`\`\`\n${f.injectContent}\n\`\`\``)
    } else if (f.metadataLine) {
      parts.push(`  ${f.metadataLine}`)
    } else {
      parts.push(`  (Content not loaded in this request — use read_file if needed.)`)
    }
  }

  return parts.join('\n')
}

function clampHistoryMessage(m: BudgetChatMessage, keepReasoning: boolean): BudgetChatMessage {
  const { text: content } = clampText(
    m.content,
    MAX_SINGLE_MESSAGE_CHARS,
    '\n\n… [context truncated: message too long]',
  )
  let reasoningContent = m.reasoningContent
  if (!keepReasoning) {
    reasoningContent = undefined
  } else if (reasoningContent && reasoningContent.length > MAX_REASONING_CHARS) {
    reasoningContent =
      reasoningContent.slice(0, MAX_REASONING_CHARS) + '\n\n… [reasoning truncated]'
  }
  return { ...m, content, reasoningContent }
}

/**
 * History for API: user/assistant only; count + char caps; reasoning on last 2 assistant only.
 */
export function truncateHistory(history: BudgetChatMessage[]): {
  messages: BudgetChatMessage[]
  warnings: string[]
} {
  const warnings: string[] = []
  if (history.length === 0) return { messages: [], warnings }

  const apiHistory = history.filter((m) => m.role === 'user' || m.role === 'assistant')
  let slice = apiHistory.slice(-MAX_HISTORY_MESSAGES)

  const assistantIndices = slice
    .map((m, i) => (m.role === 'assistant' ? i : -1))
    .filter((i) => i >= 0)
  const reasoningKeepSet = new Set(assistantIndices.slice(-MAX_REASONING_ASSISTANT_COUNT))

  slice = slice.map((m, i) =>
    clampHistoryMessage(m, m.role === 'assistant' && reasoningKeepSet.has(i)),
  )

  let total = slice.reduce((s, m) => s + messageCharLen(m), 0)
  let dropped = 0
  while (slice.length > MAX_HISTORY_MIN_MESSAGES && total > MAX_HISTORY_TOTAL_CHARS) {
    slice = slice.slice(1)
    dropped++
    total = slice.reduce((s, m) => s + messageCharLen(m), 0)
  }

  if (dropped > 0) {
    warnings.push(`已省略较早 ${dropped} 条对话以控制上下文（约 ${total.toLocaleString()} 字符保留）`)
  }

  return { messages: slice, warnings }
}

export function estimateInputChars(parts: {
  system?: string
  preface?: string
  history?: BudgetChatMessage[]
  userMessage?: string
  openFilesSection?: string
}): ContextEstimateResult {
  const system = (parts.system?.length ?? 0) + (parts.openFilesSection?.length ?? 0)
  const preface = parts.preface?.length ?? 0
  const history =
    parts.history?.reduce((s, m) => s + messageCharLen(m), 0) ?? 0
  const userMessage = parts.userMessage?.length ?? 0
  const openFiles = 0

  const breakdown: ContextBreakdown = {
    system,
    preface,
    history,
    userMessage,
    openFiles,
  }
  const total = system + preface + history + userMessage + openFiles
  return {
    breakdown,
    total,
    tokenEstimate: charsToTokenEstimate(total),
    level: contextLevel(total),
  }
}

function clampSystemPrompt(system: string, warnings: string[]): string {
  if (system.length <= MAX_SYSTEM_TOTAL_CHARS) return system
  const clamped =
    system.slice(0, MAX_SYSTEM_TOTAL_CHARS) + '\n\n… [system prompt truncated to budget]'
  warnings.push(`System 提示已截断至 ${MAX_SYSTEM_TOTAL_CHARS.toLocaleString()} 字符上限`)
  return clamped
}

function buildContextMemorySection(
  contextSummary?: string,
  pinnedFacts?: string[],
  warnings?: string[],
): string {
  const parts: string[] = []
  if (contextSummary?.trim()) {
    let summary = contextSummary.trim()
    if (summary.length > WORKING_SUMMARY_MAX_CHARS) {
      summary = summary.slice(0, WORKING_SUMMARY_MAX_CHARS) + '\n… [summary truncated]'
      warnings?.push(`对话摘要已截断至 ${WORKING_SUMMARY_MAX_CHARS.toLocaleString()} 字符`)
    }
    parts.push('', '## Earlier conversation summary', summary)
  }
  if (pinnedFacts && pinnedFacts.length > 0) {
    let pinned = pinnedFacts.join('\n')
    if (pinned.length > MAX_PINNED_FACTS_CHARS) {
      pinned = pinned.slice(0, MAX_PINNED_FACTS_CHARS) + '\n… [pinned truncated]'
      warnings?.push('Pinned 结论已截断')
    }
    parts.push('', '## Pinned facts', pinned)
  }
  return parts.join('\n')
}

/**
 * Pure assembly: clamp preface/user/history/openFiles, build system section, estimate total.
 */
export function assembleContext(input: AssembleContextInput): AssembleContextResult {
  const warnings: string[] = []

  const { text: preface, warnings: prefaceWarnings } = clampPreface(input.preface)
  warnings.push(...prefaceWarnings)

  const { text: userMessage, warnings: userWarnings } = clampUserMessage(input.userMessage)
  warnings.push(...userWarnings)

  const { messages: history, warnings: historyWarnings } = truncateHistory(input.history)
  warnings.push(...historyWarnings)

  const { files: processedOpenFiles, warnings: fileWarnings } = processOpenFilesForInjection(
    input.openFiles,
  )
  warnings.push(...fileWarnings)

  const memorySection = buildContextMemorySection(
    input.contextSummary,
    input.pinnedFacts,
    warnings,
  )
  const openFilesSection = buildOpenFilesSystemSection(processedOpenFiles)
  let system =
    input.baseSystemPrompt +
    (input.skillSystemSuffix ?? '') +
    memorySection +
    openFilesSection
  system = clampSystemPrompt(system, warnings)

  const estimate = estimateInputChars({
    system:
      input.baseSystemPrompt +
      (input.skillSystemSuffix ?? '') +
      memorySection,
    openFilesSection,
    preface,
    history,
    userMessage,
  })

  if (estimate.level === 'warn') {
    warnings.push(
      `输入上下文约 ${estimate.total.toLocaleString()} 字符（≈${estimate.tokenEstimate.toLocaleString()} tokens），接近上限`,
    )
  } else if (estimate.level === 'over') {
    warnings.push(
      `输入上下文约 ${estimate.total.toLocaleString()} 字符，已超过 ${MAX_REQUEST_INPUT_CHARS.toLocaleString()} 字符硬顶，部分内容由主进程裁切`,
    )
  }

  return {
    system,
    preface,
    userMessage,
    history,
    openFiles: processedOpenFiles,
    warnings,
    estimate,
  }
}
