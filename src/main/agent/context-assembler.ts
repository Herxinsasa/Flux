import { getFileInfo } from '../services/file-service'
import { getCachedLogIndex, scheduleLogIndex } from '../services/log-index-service'
import {
  assembleContext,
  LARGE_FILE_NO_INJECT_BYTES,
  type AssembleContextResult,
  type BudgetChatMessage,
  type OpenFileContext,
} from '../../shared/context-budget'
import type { ChatMessage } from './provider-router'
import log from '../logger'

export interface AssembleAgentContextInput {
  /** Base system rules (without open-file section — assembler adds it) */
  baseSystemPrompt: string
  /** Skill injection appended to system */
  skillSystemSuffix?: string
  contextSummary?: string
  pinnedFacts?: string[]
  preface?: string
  userMessage: string
  history: ChatMessage[]
  openFiles?: OpenFileContext[]
}

export interface AssembleAgentContextResult extends AssembleContextResult {
  chatMessages: ChatMessage[]
}

function enrichOpenFiles(openFiles: OpenFileContext[]): OpenFileContext[] {
  return openFiles.map((f) => {
    let enriched = f
    if (f.sizeBytes == null || f.lines == null) {
      try {
        const info = getFileInfo(f.path)
        enriched = {
          ...f,
          sizeBytes: f.sizeBytes ?? info.size,
          lines: f.lines ?? info.lines,
          encoding: f.encoding ?? info.encoding,
        }
      } catch (err) {
        // 无法获取文件信息 → 保守处理，标记为大文件避免误注入全文
        log.warn('context-assembler: getFileInfo failed', { path: f.path, err })
        if (enriched.sizeBytes == null) {
          enriched = {
            ...enriched,
            sizeBytes: LARGE_FILE_NO_INJECT_BYTES + 1,
            lines: enriched.lines ?? 0,
          }
        }
      }
    }

    const size = enriched.sizeBytes ?? 0
    const isLog = enriched.path.toLowerCase().endsWith('.log')
    if (isLog && size > LARGE_FILE_NO_INJECT_BYTES) {
      try {
        const idx = getCachedLogIndex(enriched.path)
        if (idx) {
          enriched = { ...enriched, indexSummary: idx.summaryText }
        } else {
          scheduleLogIndex(enriched.path)
          enriched = {
            ...enriched,
            indexSummary: 'Log index is being prepared. Use search_content or read_file for targeted details.',
          }
        }
      } catch (err) {
        log.warn('context-assembler: log index failed', { path: f.path, err })
      }
    }

    return enriched
  })
}

/**
 * Main-process single source of truth for context assembly before runAgent.
 */
export function assembleAgentContext(input: AssembleAgentContextInput): AssembleAgentContextResult {
  const openFiles = enrichOpenFiles(input.openFiles ?? [])

  const assembled = assembleContext({
    baseSystemPrompt: input.baseSystemPrompt,
    skillSystemSuffix: input.skillSystemSuffix,
    contextSummary: input.contextSummary,
    pinnedFacts: input.pinnedFacts,
    preface: input.preface,
    userMessage: input.userMessage,
    history: input.history as BudgetChatMessage[],
    openFiles,
  })

  const chatMessages: ChatMessage[] = []

  for (const h of assembled.history) {
    chatMessages.push({
      role: h.role as 'user' | 'assistant',
      content: h.content,
      reasoningContent: h.reasoningContent,
      toolCallId: h.toolCallId,
      toolName: h.toolName,
      input: h.input,
    })
  }

  const userBody = [assembled.preface, assembled.userMessage].filter(Boolean).join('\n\n')
  chatMessages.push({ role: 'user', content: userBody })

  if (assembled.warnings.length > 0) {
    log.info('Context assembly warnings:', assembled.warnings)
  }

  return {
    ...assembled,
    chatMessages,
  }
}
