import { create } from 'zustand'
import { useChatStore, type Message } from './chatStore'
import { useSettingsStore } from './settingsStore'
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
import type { LoadedSession } from '../../../shared/session-storage'

interface SessionContextState {
  workingSummary: string | null
  compressedUpToMessageId: string | null
  pinnedFacts: string[]
  autoCompressHistory: boolean
  activeSessionId: string | null
  activeWorkspaceRoot: string | null
  setAutoCompressHistory: (enabled: boolean) => void
  compressFromMessages: (messages: Message[]) => string
  resetConversationContext: () => void
  getHistoryForApi: (messages: Message[]) => CompressibleMessage[]
  pinFact: (text: string) => boolean
  pinFromMessageContent: (content: string) => boolean
  unpinFact: (index: number) => void
  isFactPinned: (text: string) => boolean
  loadWorkspaceSession: (workspaceRoot: string) => Promise<void>
  ensureActiveSession: (workspaceRoot: string) => Promise<boolean>
  persistWorkspaceSession: (workspaceRoot: string, advanceCompressionCursor?: boolean) => Promise<boolean>
  appendMessageEvent: (workspaceRoot: string, message: Message) => Promise<void>
  compactAndPersist: (workspaceRoot: string, messages: Message[], focus?: string) => Promise<boolean>
  scheduleCleanup: () => Promise<void>
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

function normalizeWorkspaceRoot(workspaceRoot: string): string {
  return workspaceRoot.trim().replace(/[\\/]+$/, '').toLowerCase()
}

function hasStructuredSummary(loaded: LoadedSession): boolean {
  const summary = loaded.checkpoint.summary
  return Boolean(
    summary.taskGoal?.trim() ||
    summary.confirmedFacts.length ||
    summary.userConstraints.length ||
    summary.documentReferences.length ||
    summary.openQuestions.length ||
    summary.nextSteps.length,
  )
}

function compressedThroughSequence(loaded: LoadedSession): number {
  if (!['compact', 'automatic', 'legacy'].includes(loaded.checkpoint.source)) return 0
  if (!hasStructuredSummary(loaded)) return 0
  return loaded.checkpoint.throughSequence
}

function restoredMessages(loaded: LoadedSession): Message[] {
  const throughSequence = compressedThroughSequence(loaded)
  return loaded.events
    .filter((event) =>
      event.kind === 'message' &&
      event.sequence > throughSequence &&
      (event.role === 'user' || event.role === 'assistant') &&
      typeof event.content === 'string' &&
      event.content.trim().length > 0,
    )
    .map((event) => ({
      id: `${loaded.meta.sessionId}:${event.sequence}`,
      role: event.role === 'assistant' ? 'ai' : 'user',
      content: event.content!,
      timestamp: event.timestamp,
    }))
}

export const useSessionContextStore = create<SessionContextState>((set, get) => ({
  workingSummary: null,
  compressedUpToMessageId: null,
  pinnedFacts: [],
  autoCompressHistory: true,
  activeSessionId: null,
  activeWorkspaceRoot: null,

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

  resetConversationContext: () => {
    useChatStore.getState().clearMessages()
    set({
      activeSessionId: null,
      activeWorkspaceRoot: null,
      pinnedFacts: [],
      workingSummary: null,
      compressedUpToMessageId: null,
    })
  },

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
    get().resetConversationContext()
    set({ activeWorkspaceRoot: workspaceRoot })
    if (!useSettingsStore.getState().sessionPersistenceEnabled) return
    try {
      const listed = await window.electronAPI.workspace.session.list(workspaceRoot) as { success?: boolean; data?: Array<{ sessionId: string }> }
      if (listed?.success && listed.data?.[0]) {
        const loadedResult = await window.electronAPI.workspace.session.load(workspaceRoot, listed.data[0].sessionId) as { success?: boolean; data?: LoadedSession }
        const loaded = loadedResult?.data
        if (loadedResult?.success && loaded) {
          if (normalizeWorkspaceRoot(get().activeWorkspaceRoot ?? '') !== normalizeWorkspaceRoot(workspaceRoot)) return
          const throughSequence = compressedThroughSequence(loaded)
          set({
            activeSessionId: loaded.meta.sessionId,
            activeWorkspaceRoot: workspaceRoot,
            pinnedFacts: loaded.checkpoint.pinnedFacts ?? [],
            workingSummary: loaded.checkpoint.summary.taskGoal?.trim() || null,
            compressedUpToMessageId: throughSequence > 0
              ? `${loaded.meta.sessionId}:${throughSequence}`
              : null,
          })
          useChatStore.getState().restoreMessages(restoredMessages(loaded))
          return
        }
      }
      const res = (await window.electronAPI.workspace.readSession(workspaceRoot)) as { success?: boolean; data?: WorkspaceSessionPayload }
      if (!res?.success || !res.data) return
      if (normalizeWorkspaceRoot(get().activeWorkspaceRoot ?? '') !== normalizeWorkspaceRoot(workspaceRoot)) return
      set({
        pinnedFacts: res.data.pinnedFacts ?? [],
        workingSummary: res.data.workingSummary?.trim() || null,
        compressedUpToMessageId: null,
      })
    } catch {
      /* ignore */
    }
  },

  ensureActiveSession: async (workspaceRoot) => {
    if (!useSettingsStore.getState().sessionPersistenceEnabled) return false
    const state = get()
    if (
      state.activeSessionId &&
      normalizeWorkspaceRoot(state.activeWorkspaceRoot ?? '') === normalizeWorkspaceRoot(workspaceRoot)
    ) return true
    if (state.activeWorkspaceRoot && normalizeWorkspaceRoot(state.activeWorkspaceRoot) !== normalizeWorkspaceRoot(workspaceRoot)) {
      state.resetConversationContext()
    }
    set({ activeWorkspaceRoot: workspaceRoot })
    try {
      const created = await window.electronAPI.workspace.session.create({ workspaceRoot, title: 'Conversation' }) as { success?: boolean; data?: LoadedSession }
      if (!created?.success || !created.data) return false
      if (normalizeWorkspaceRoot(get().activeWorkspaceRoot ?? '') !== normalizeWorkspaceRoot(workspaceRoot)) return false
      set({ activeSessionId: created.data.meta.sessionId, activeWorkspaceRoot: workspaceRoot })
      return true
    } catch {
      return false
    }
  },

  persistWorkspaceSession: async (workspaceRoot, advanceCompressionCursor = false) => {
    if (!useSettingsStore.getState().sessionPersistenceEnabled) return true
    const { pinnedFacts, workingSummary, activeSessionId } = get()
    try {
      let sessionId = activeSessionId
      if (!sessionId) {
        if (!await get().ensureActiveSession(workspaceRoot)) return false
        sessionId = get().activeSessionId
      }
      if (!sessionId) return false
      const loaded = await window.electronAPI.workspace.session.load(workspaceRoot, sessionId) as { success?: boolean; data?: LoadedSession }
      if (!loaded?.success || !loaded.data) return false
      const checkpoint = loaded.data.checkpoint
      const res = await window.electronAPI.workspace.session.checkpoint({ workspaceRoot, sessionId, checkpoint: {
        throughSequence: advanceCompressionCursor
          ? loaded.data.events.at(-1)?.sequence ?? checkpoint.throughSequence
          : checkpoint.throughSequence,
        model: checkpoint.model,
        summary: { ...checkpoint.summary, taskGoal: workingSummary },
        pinnedFacts, documentReferences: checkpoint.documentReferences, source: 'automatic',
      } }) as { success?: boolean }
      return Boolean(res?.success)
    } catch {
      return false
    }
  },

  appendMessageEvent: async (workspaceRoot, message) => {
    if (!useSettingsStore.getState().sessionPersistenceEnabled) return
    if (!await get().ensureActiveSession(workspaceRoot)) return
    const { activeSessionId } = get()
    if (!activeSessionId || !message.content.trim()) return
    await window.electronAPI.workspace.session.append({
      workspaceRoot,
      sessionId: activeSessionId,
      event: { kind: 'message', role: message.role === 'ai' ? 'assistant' : 'user', content: message.content, timestamp: message.timestamp },
    }).catch(() => undefined)
  },

  compactAndPersist: async (workspaceRoot, messages, focus) => {
    if (!useSettingsStore.getState().sessionPersistenceEnabled) return false
    const previous = get()
    const result = compressSessionHistory(toCompressible(messages), previous.workingSummary)
    const sessionId = previous.activeSessionId
    if (!sessionId) return false
    try {
      const loaded = await window.electronAPI.workspace.session.load(workspaceRoot, sessionId) as { success?: boolean; data?: LoadedSession }
      if (!loaded?.success || !loaded.data) return false
      const checkpoint = loaded.data.checkpoint
      const saved = await window.electronAPI.workspace.session.checkpoint({ workspaceRoot, sessionId, checkpoint: {
        throughSequence: loaded.data.events.at(-1)?.sequence ?? checkpoint.throughSequence,
        model: checkpoint.model,
        summary: { ...checkpoint.summary, taskGoal: result.workingSummary || null },
        pinnedFacts: previous.pinnedFacts, documentReferences: checkpoint.documentReferences, focus, source: 'compact',
      } }) as { success?: boolean }
      if (!saved?.success) return false
      set({ workingSummary: result.workingSummary || null, compressedUpToMessageId: result.compressedUpToMessageId })
      return true
    } catch {
      return false
    }
  },

  scheduleCleanup: async () => {
    const preferences = useSettingsStore.getState()
    if (!preferences.sessionPersistenceEnabled) return
    try {
      await window.electronAPI.workspace.session.cleanup({
        retentionDays: preferences.sessionRetentionDays,
        maxBytes: preferences.sessionMaxStorageMb * 1024 * 1024,
        protectedSessionIds: get().activeSessionId ? [get().activeSessionId] : [],
      })
    } catch {
      // Background cleanup must never block the first window or editor input.
    }
  },
}))
