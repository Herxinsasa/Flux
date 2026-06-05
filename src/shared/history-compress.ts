import {
  AUTO_COMPRESS_HISTORY_CHARS,
  AUTO_COMPRESS_MESSAGE_COUNT,
  MAX_HISTORY_HOT_MESSAGES,
  WORKING_SUMMARY_MAX_CHARS,
} from './context-budget'

export interface CompressibleMessage {
  id: string
  role: 'user' | 'ai'
  content: string
  reasoningContent?: string
}

export function historyCharCount(messages: CompressibleMessage[]): number {
  return messages.reduce(
    (sum, m) => sum + m.content.length + (m.reasoningContent?.length ?? 0),
    0,
  )
}

export function shouldAutoCompress(
  messages: CompressibleMessage[],
  autoEnabled: boolean,
): boolean {
  if (!autoEnabled || messages.length === 0) return false
  const apiMessages = messages.filter((m) => m.role === 'user' || m.role === 'ai')
  if (apiMessages.length > AUTO_COMPRESS_MESSAGE_COUNT) return true
  return historyCharCount(apiMessages) > AUTO_COMPRESS_HISTORY_CHARS
}

/** Keep the most recent N user/ai messages when a working summary is active. */
export function selectHotHistory(
  messages: CompressibleMessage[],
  hotCount = MAX_HISTORY_HOT_MESSAGES,
): CompressibleMessage[] {
  const api = messages.filter((m) => m.role === 'user' || m.role === 'ai')
  if (api.length <= hotCount) return api
  return api.slice(-hotCount)
}

function uniqueLines(lines: string[], max: number): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const line of lines) {
    const t = line.trim()
    if (!t || seen.has(t)) continue
    seen.add(t)
    out.push(t)
    if (out.length >= max) break
  }
  return out
}

function extractFromContent(content: string): string[] {
  const lines: string[] = []
  for (const m of content.matchAll(/^#{1,3}\s+(.+)$/gm)) {
    lines.push(`- ${m[1]!.trim()}`)
  }
  for (const m of content.matchAll(/\*\*([^*]{4,120})\*\*/g)) {
    lines.push(`- ${m[1]!.trim()}`)
  }
  for (const m of content.matchAll(/\bL\d+(?:-\d+)?\b/g)) {
    lines.push(`- 行号 ${m[0]}`)
  }
  for (const m of content.matchAll(/\b(ERROR|WARN(?:ING)?|FATAL|Exception|timeout)\b[^\n]{0,80}/gi)) {
    lines.push(`- ${m[0].trim()}`)
  }
  return lines
}

/**
 * Rule-based compression (no extra LLM call).
 */
export function buildWorkingSummary(
  messages: CompressibleMessage[],
  existingSummary?: string | null,
  maxChars = WORKING_SUMMARY_MAX_CHARS,
): string {
  const cold = messages.filter((m) => m.role === 'user' || m.role === 'ai')
  const hotStart = Math.max(0, cold.length - MAX_HISTORY_HOT_MESSAGES)
  const toCompress = cold.slice(0, hotStart)

  const parts: string[] = []
  if (existingSummary?.trim()) {
    parts.push(existingSummary.trim())
  }

  const firstUser = toCompress.find((m) => m.role === 'user')
  if (firstUser?.content.trim()) {
    const q = firstUser.content.trim().replace(/\s+/g, ' ').slice(0, 240)
    parts.push(`用户首问：${q}`)
  }

  const bullets: string[] = []
  for (const m of toCompress) {
    if (m.role !== 'ai') continue
    bullets.push(...extractFromContent(m.content))
  }

  const deduped = uniqueLines(bullets, 40)
  if (deduped.length > 0) {
    parts.push('要点：', ...deduped)
  }

  let out = parts.join('\n').trim()
  if (out.length > maxChars) {
    out = out.slice(0, maxChars) + '\n… [summary truncated]'
  }
  return out
}

export function compressSessionHistory(
  messages: CompressibleMessage[],
  existingSummary?: string | null,
): {
  workingSummary: string
  compressedUpToMessageId: string | null
  hotMessages: CompressibleMessage[]
} {
  const api = messages.filter((m) => m.role === 'user' || m.role === 'ai')
  const hot = selectHotHistory(api)
  const hotIds = new Set(hot.map((m) => m.id))
  const cold = api.filter((m) => !hotIds.has(m.id))
  const lastColdId = cold.length > 0 ? cold[cold.length - 1]!.id : null

  const workingSummary = buildWorkingSummary(api, existingSummary)
  return {
    workingSummary,
    compressedUpToMessageId: lastColdId,
    hotMessages: hot,
  }
}
