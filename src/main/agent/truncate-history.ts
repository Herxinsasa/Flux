import type { ChatMessage } from './provider-router'
import log from '../logger'

/** 避免对话过长撑爆模型上下文（与模型上限无关，属客户端防护） */
const MAX_HISTORY_MESSAGES = 48
/** 约相当于数十万 tokens 量级防护（中英混合按字符粗估） */
const MAX_HISTORY_TOTAL_CHARS = 320_000
const MAX_SINGLE_MESSAGE_CHARS = 120_000

function charLen(m: ChatMessage): number {
  return m.content.length + (m.reasoningContent?.length ?? 0)
}

function clampMessage(m: ChatMessage): ChatMessage {
  let content = m.content
  let reasoningContent = m.reasoningContent
  if (content.length > MAX_SINGLE_MESSAGE_CHARS) {
    content =
      content.slice(0, MAX_SINGLE_MESSAGE_CHARS) +
      '\n\n… [context truncated: message too long]'
  }
  if (reasoningContent && reasoningContent.length > MAX_SINGLE_MESSAGE_CHARS) {
    reasoningContent =
      reasoningContent.slice(0, MAX_SINGLE_MESSAGE_CHARS) +
      '\n\n… [truncated]'
  }
  return { ...m, content, reasoningContent }
}

/**
 * 保留最近若干条，并限制总字符；单条过长也会截断。
 * 说明：具体模型的 token 上限由供应商决定（例如你遇到的约 1M tokens），
 * 此处只防止「历史消息」无限增长导致请求体过大。
 */
export function truncateChatHistory(history: ChatMessage[]): ChatMessage[] {
  if (history.length === 0) return history

  let slice = history.slice(-MAX_HISTORY_MESSAGES).map(clampMessage)

  let total = slice.reduce((s, m) => s + charLen(m), 0)
  let dropped = 0
  while (slice.length > 4 && total > MAX_HISTORY_TOTAL_CHARS) {
    slice = slice.slice(1)
    dropped++
    total = slice.reduce((s, m) => s + charLen(m), 0)
  }

  if (dropped > 0) {
    log.info(
      `ChatHistory: dropped ${dropped} older message(s); approx ${total} chars retained (cap ~${MAX_HISTORY_TOTAL_CHARS})`,
    )
  }

  return slice
}
