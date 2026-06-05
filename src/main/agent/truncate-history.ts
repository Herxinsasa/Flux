import type { ChatMessage } from './provider-router'
import { truncateHistory } from '../../shared/context-budget'
import log from '../logger'

/**
 * @deprecated Prefer assembleAgentContext; kept for direct callers.
 * Delegates to shared context-budget.truncateHistory (24 msgs / 140K / 40K per msg).
 */
export function truncateChatHistory(history: ChatMessage[]): ChatMessage[] {
  const { messages, warnings } = truncateHistory(history)
  if (warnings.length > 0) {
    log.info('ChatHistory:', warnings.join('; '))
  }
  return messages as ChatMessage[]
}
