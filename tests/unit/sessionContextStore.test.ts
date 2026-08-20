import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useChatStore } from '../../src/renderer/src/stores/chatStore'
import { useSessionContextStore } from '../../src/renderer/src/stores/sessionContextStore'
import { useSettingsStore } from '../../src/renderer/src/stores/settingsStore'

const workspaceRoot = 'C:\\workspace'
const workspaceRootB = 'C:\\workspace-b'
const sessionId = '11111111-1111-4111-8111-111111111111'
const sessionIdB = '22222222-2222-4222-8222-222222222222'

function loadedSession(
  events: Array<Record<string, unknown>> = [],
  throughSequence = 0,
  options: { id?: string; source?: string; taskGoal?: string | null; pinnedFacts?: string[] } = {},
) {
  const id = options.id ?? sessionId
  return {
    meta: { sessionId: id },
    checkpoint: {
      throughSequence,
      source: options.source ?? 'compact',
      pinnedFacts: options.pinnedFacts ?? ['keep this'],
      summary: {
        taskGoal: options.taskGoal === undefined ? 'finish review' : options.taskGoal,
        confirmedFacts: [],
        userConstraints: [],
        documentReferences: [],
        openQuestions: [],
        nextSteps: [],
      },
      model: null,
      documentReferences: [],
    },
    events,
  }
}

describe('session context persistence', () => {
  const create = vi.fn()
  const list = vi.fn()
  const load = vi.fn()
  const append = vi.fn()
  const cleanup = vi.fn()
  const readSession = vi.fn()
  const checkpoint = vi.fn()

  beforeEach(() => {
    create.mockReset()
    list.mockReset()
    load.mockReset()
    append.mockReset()
    cleanup.mockReset()
    readSession.mockReset()
    checkpoint.mockReset()
    ;(globalThis as typeof globalThis & { window: Window }).window = {
      electronAPI: {
        workspace: {
          session: { create, list, load, append, checkpoint, usage: vi.fn(), cleanup, clear: vi.fn() },
          readSession,
        },
      },
    } as unknown as Window
    useChatStore.setState({ messages: [], agentStatus: 'idle' })
    useSessionContextStore.setState({
      activeSessionId: null,
      activeWorkspaceRoot: null,
      workingSummary: null,
      compressedUpToMessageId: null,
      pinnedFacts: [],
    })
    useSettingsStore.setState({ sessionPersistenceEnabled: true, sessionRetentionDays: 30, sessionMaxStorageMb: 200 })
  })

  it('creates a session before persisting the first ordinary message', async () => {
    create.mockResolvedValue({ success: true, data: loadedSession() })
    append.mockResolvedValue({ success: true })

    await useSessionContextStore.getState().appendMessageEvent(workspaceRoot, {
      id: 'local-user', role: 'user', content: 'first message', timestamp: 10,
    })

    expect(create).toHaveBeenCalledWith({ workspaceRoot, title: 'Conversation' })
    expect(append).toHaveBeenCalledWith(expect.objectContaining({
      workspaceRoot,
      sessionId,
      event: expect.objectContaining({ kind: 'message', role: 'user', content: 'first message' }),
    }))
  })

  it('restores only events after the compact checkpoint with stable IDs', async () => {
    list.mockResolvedValue({ success: true, data: [{ sessionId }] })
    load.mockResolvedValue({ success: true, data: loadedSession([
      { kind: 'message', sequence: 1, role: 'user', content: 'cold', timestamp: 1 },
      { kind: 'message', sequence: 2, role: 'assistant', content: 'hot answer', timestamp: 2 },
    ], 1) })

    await useSessionContextStore.getState().loadWorkspaceSession(workspaceRoot)

    expect(useSessionContextStore.getState().compressedUpToMessageId).toBe(`${sessionId}:1`)
    expect(useChatStore.getState().messages).toEqual([
      { id: `${sessionId}:2`, role: 'ai', content: 'hot answer', timestamp: 2 },
    ])
  })

  it('restores full history after a pin-only checkpoint and keeps pinned facts', async () => {
    list.mockResolvedValue({ success: true, data: [{ sessionId }] })
    load.mockResolvedValue({ success: true, data: loadedSession([
      { kind: 'message', sequence: 1, role: 'user', content: 'decision', timestamp: 1 },
      { kind: 'message', sequence: 2, role: 'assistant', content: 'confirmed', timestamp: 2 },
    ], 2, { source: 'automatic', taskGoal: null, pinnedFacts: ['fixed fact'] }) })

    await useSessionContextStore.getState().loadWorkspaceSession(workspaceRoot)

    expect(useSessionContextStore.getState().pinnedFacts).toEqual(['fixed fact'])
    expect(useSessionContextStore.getState().compressedUpToMessageId).toBeNull()
    expect(useChatStore.getState().messages.map((message) => message.content)).toEqual(['decision', 'confirmed'])
  })

  it('does not advance the compression cursor when only pinned facts are persisted', async () => {
    useSessionContextStore.setState({ activeSessionId: sessionId, activeWorkspaceRoot: workspaceRoot, pinnedFacts: ['fixed fact'] })
    load.mockResolvedValue({ success: true, data: loadedSession([
      { kind: 'message', sequence: 1, role: 'user', content: 'still hot', timestamp: 1 },
    ], 0, { source: 'initial', taskGoal: null }) })
    checkpoint.mockResolvedValue({ success: true })

    await useSessionContextStore.getState().persistWorkspaceSession(workspaceRoot)

    expect(checkpoint).toHaveBeenCalledWith(expect.objectContaining({
      checkpoint: expect.objectContaining({ throughSequence: 0 }),
    }))
  })

  it('isolates A and B workspaces without reusing A session state', async () => {
    list.mockImplementation(async (root: string) => ({
      success: true,
      data: [{ sessionId: root === workspaceRoot ? sessionId : sessionIdB }],
    }))
    load.mockImplementation(async (root: string) => ({
      success: true,
      data: loadedSession([
        { kind: 'message', sequence: 1, role: 'user', content: root === workspaceRoot ? 'A history' : 'B history', timestamp: 1 },
      ], 0, {
        id: root === workspaceRoot ? sessionId : sessionIdB,
        source: 'initial',
        taskGoal: null,
        pinnedFacts: root === workspaceRoot ? ['A fact'] : ['B fact'],
      }),
    }))

    await useSessionContextStore.getState().loadWorkspaceSession(workspaceRoot)
    await useSessionContextStore.getState().loadWorkspaceSession(workspaceRootB)

    expect(useSessionContextStore.getState().activeSessionId).toBe(sessionIdB)
    expect(useSessionContextStore.getState().activeWorkspaceRoot).toBe(workspaceRootB)
    expect(useSessionContextStore.getState().pinnedFacts).toEqual(['B fact'])
    expect(useChatStore.getState().messages.map((message) => message.content)).toEqual(['B history'])
  })

  it('does not create or append when persistence is disabled', async () => {
    useSettingsStore.setState({ sessionPersistenceEnabled: false })

    await useSessionContextStore.getState().appendMessageEvent(workspaceRoot, {
      id: 'local-user', role: 'user', content: 'memory only', timestamp: 10,
    })

    expect(create).not.toHaveBeenCalled()
    expect(append).not.toHaveBeenCalled()
  })

  it('cleans with the configured retention and capacity while protecting the active session', async () => {
    useSettingsStore.setState({ sessionRetentionDays: 14, sessionMaxStorageMb: 64 })
    useSessionContextStore.setState({ activeSessionId: sessionId })

    await useSessionContextStore.getState().scheduleCleanup()

    expect(cleanup).toHaveBeenCalledWith({
      retentionDays: 14,
      maxBytes: 64 * 1024 * 1024,
      protectedSessionIds: [sessionId],
    })
  })

  it('resets a cleared session and creates a fresh session for the next message', async () => {
    useSessionContextStore.setState({
      activeSessionId: sessionId,
      activeWorkspaceRoot: workspaceRoot,
      pinnedFacts: ['old fact'],
      workingSummary: 'old summary',
      compressedUpToMessageId: 'old:2',
    })
    useChatStore.setState({
      messages: [{ id: 'old', role: 'user', content: 'old message', timestamp: 1 }],
    })
    create.mockResolvedValue({ success: true, data: loadedSession([], 0, { id: sessionIdB, source: 'initial', taskGoal: null, pinnedFacts: [] }) })
    append.mockResolvedValue({ success: true })

    useSessionContextStore.getState().resetConversationContext()
    await useSessionContextStore.getState().appendMessageEvent(workspaceRoot, {
      id: 'new', role: 'user', content: 'continue after clear', timestamp: 3,
    })

    expect(useSessionContextStore.getState().pinnedFacts).toEqual([])
    expect(useChatStore.getState().messages).toEqual([])
    expect(create).toHaveBeenCalledWith({ workspaceRoot, title: 'Conversation' })
    expect(append).toHaveBeenCalledWith(expect.objectContaining({ sessionId: sessionIdB }))
  })
})
