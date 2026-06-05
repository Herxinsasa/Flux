import { create } from 'zustand'
import type { Message } from './chatStore'
import {
  compressSessionHistory,
  selectHotHistory,
  type CompressibleMessage,
} from '../../../shared/history-compress'
import {
  MAX_PINNED_FACT_COUNT,
  MAX_PINNED_FACT_CHARS,
} from '../../../shared/context-budget'
import { extractPinCandidate } from '../../../shared/session-summary'
import type { WorkspaceSessionPayload } from '../../../shared/types'

interface SessionContextState {
  workingSummary: string | null
  compressedUpToMessageId: string | null
  pinnedFacts: string[]
  autoCompressHistory: boolean
  setAutoCompressHistory: (enabled: boolean) => void
  compressFromMessages: (messages: Message[]) => string
  resetConversationContext: () => void
  getHistoryForApi: (messages: Message[]) => CompressibleMessage[]
  pinFact: (text: string) => boolean
  pinFromMessageContent: (content: string) => boolean
  unpinFact: (index: number) => void
  isFactPinned: (text: string) => boolean
  loadWorkspaceSession: (workspaceRoot: string) => Promise<void>
  persistWorkspaceSession: (workspaceRoot: string) => Promise<boolean>
}

function toCompressible(messages: Message[]): CompressibleMessage[] {
  return messages.map((m) => ({
    id: m.id,
    role: m.role,
    content: m.content,
    reasoningContent: m.reasoningContent,
  }))
}

function normalizeFact(text: string): string {
  return text.trim().replace(/\s+/g, ' ')
}

export const useSessionContextStore = create<SessionContextState>((set, get) => ({
  workingSummary: null,
  compressedUpToMessageId: null,
  pinnedFacts: [],
  autoCompressHistory: true,

  setAutoCompressHistory: (enabled) => set({ autoCompressHistory: enabled }),

  compressFromMessages: (messages) => {
    const { workingSummary: existing } = get()
    const result = compressSessionHistory(toCompressible(messages), existing)
    set({
      workingSummary: result.workingSummary || null,
      compressedUpToMessageId: result.compressedUpToMessageId,
    })
    return result.workingSummary
  },

  resetConversationContext: () =>
    set({
      workingSummary: null,
      compressedUpToMessageId: null,
    }),

  getHistoryForApi: (messages) => {
    const { workingSummary } = get()
    const all = toCompressible(messages)
    if (!workingSummary?.trim()) return all
    return selectHotHistory(all)
  },

  pinFact: (raw) => {
    const text = normalizeFact(raw)
    if (!text) return false
    const clipped = text.slice(0, MAX_PINNED_FACT_CHARS)
    const { pinnedFacts } = get()
    if (pinnedFacts.some((f) => f === clipped)) return false
    if (pinnedFacts.length >= MAX_PINNED_FACT_COUNT) return false
    set({ pinnedFacts: [...pinnedFacts, clipped] })
    return true
  },

  pinFromMessageContent: (content) => {
    const candidate = extractPinCandidate(content)
    if (!candidate) return false
    return get().pinFact(candidate)
  },

  unpinFact: (index) => {
    const { pinnedFacts } = get()
    if (index < 0 || index >= pinnedFacts.length) return
    set({ pinnedFacts: pinnedFacts.filter((_, i) => i !== index) })
  },

  isFactPinned: (text) => {
    const candidate = normalizeFact(extractPinCandidate(text) || text)
    if (!candidate) return false
    return get().pinnedFacts.some((f) => f === candidate || candidate.includes(f) || f.includes(candidate))
  },

  loadWorkspaceSession: async (workspaceRoot) => {
    try {
      const res = (await window.electronAPI.workspace.readSession(workspaceRoot)) as {
        success?: boolean
        data?: WorkspaceSessionPayload
      }
      if (!res?.success || !res.data) return
      set({
        pinnedFacts: res.data.pinnedFacts ?? [],
        workingSummary: res.data.workingSummary?.trim() || null,
        compressedUpToMessageId: null,
      })
    } catch {
      /* ignore */
    }
  },

  persistWorkspaceSession: async (workspaceRoot) => {
    const { pinnedFacts, workingSummary } = get()
    try {
      const res = (await window.electronAPI.workspace.writeSession(workspaceRoot, {
        pinnedFacts,
        workingSummary,
      })) as { success?: boolean }
      return Boolean(res?.success)
    } catch {
      return false
    }
  },
}))
