import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '../../shared/ipc-channels'
import type { IpcResponse, WorkspaceSessionPayload } from '../../shared/types'
import {
  readWorkspaceSession,
} from '../services/session-summary-service'
import { getSessionStore } from '../services/session-storage-service'

export function registerSessionHandlers(): void {
  const {
    WORKSPACE_SESSION_READ, WORKSPACE_SESSION_WRITE, SESSION_CREATE, SESSION_LIST,
    SESSION_LOAD, SESSION_APPEND, SESSION_CHECKPOINT, SESSION_USAGE, SESSION_CLEANUP, SESSION_CLEAR,
  } = IPC_CHANNELS
  const sessions = getSessionStore()

  ipcMain.handle(
    WORKSPACE_SESSION_READ,
    async (_event, workspaceRoot: string): Promise<IpcResponse<WorkspaceSessionPayload>> => {
      try {
        if (!workspaceRoot || typeof workspaceRoot !== 'string') {
          return { success: false, error: 'Invalid workspace root' }
        }
        const items = await sessions.listSessions(workspaceRoot)
        if (items[0]) {
          const loaded = await sessions.loadSession(workspaceRoot, items[0].sessionId)
          return { success: true, data: { pinnedFacts: loaded.checkpoint.pinnedFacts, workingSummary: loaded.checkpoint.summary.taskGoal } }
        }
        const data = readWorkspaceSession(workspaceRoot)
        return { success: true, data }
      } catch (err) {
        return { success: false, error: String(err) }
      }
    },
  )

  ipcMain.handle(
    WORKSPACE_SESSION_WRITE,
    async (
      _event,
      workspaceRoot: string,
      payload: WorkspaceSessionPayload,
    ): Promise<IpcResponse<null>> => {
      try {
        if (!workspaceRoot || typeof workspaceRoot !== 'string') {
          return { success: false, error: 'Invalid workspace root' }
        }
        const existing = (await sessions.listSessions(workspaceRoot))[0]
        const loaded = existing
          ? await sessions.loadSession(workspaceRoot, existing.sessionId)
          : await sessions.createSession({ workspaceRoot, title: 'Conversation' })
        await sessions.writeCheckpoint({ workspaceRoot, sessionId: loaded.meta.sessionId, checkpoint: {
          throughSequence: loaded.events.at(-1)?.sequence ?? loaded.checkpoint.throughSequence,
          model: loaded.meta.model,
          summary: { ...loaded.checkpoint.summary, taskGoal: payload.workingSummary ?? null },
          pinnedFacts: payload.pinnedFacts ?? [], documentReferences: loaded.checkpoint.documentReferences, source: 'automatic',
        } })
        return { success: true, data: null }
      } catch (err) {
        return { success: false, error: String(err) }
      }
    },
  )

  ipcMain.handle(SESSION_CREATE, async (_event, input) => {
    try { return { success: true, data: await sessions.createSession(input) } } catch (error) { return { success: false, error: String(error) } }
  })
  ipcMain.handle(SESSION_LIST, async (_event, workspaceRoot) => {
    try { return { success: true, data: await sessions.listSessions(workspaceRoot) } } catch (error) { return { success: false, error: String(error) } }
  })
  ipcMain.handle(SESSION_LOAD, async (_event, workspaceRoot, sessionId) => {
    try { return { success: true, data: await sessions.loadSession(workspaceRoot, sessionId) } } catch (error) { return { success: false, error: String(error) } }
  })
  ipcMain.handle(SESSION_APPEND, async (_event, input) => {
    try { return { success: true, data: await sessions.appendEvent(input) } } catch (error) { return { success: false, error: String(error) } }
  })
  ipcMain.handle(SESSION_CHECKPOINT, async (_event, input) => {
    try { return { success: true, data: await sessions.writeCheckpoint(input) } } catch (error) { return { success: false, error: String(error) } }
  })
  ipcMain.handle(SESSION_USAGE, async () => {
    try { return { success: true, data: await sessions.usage() } } catch (error) { return { success: false, error: String(error) } }
  })
  ipcMain.handle(SESSION_CLEANUP, async (_event, options) => {
    try { return { success: true, data: await sessions.cleanup(options) } } catch (error) { return { success: false, error: String(error) } }
  })
  ipcMain.handle(SESSION_CLEAR, async (_event, protectedSessionIds) => {
    try { return { success: true, data: await sessions.clearAll(protectedSessionIds) } } catch (error) { return { success: false, error: String(error) } }
  })
}
