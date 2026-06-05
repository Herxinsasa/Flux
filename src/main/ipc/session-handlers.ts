import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '../../shared/ipc-channels'
import type { IpcResponse, WorkspaceSessionPayload } from '../../shared/types'
import {
  readWorkspaceSession,
  writeWorkspaceSession,
} from '../services/session-summary-service'

export function registerSessionHandlers(): void {
  const { WORKSPACE_SESSION_READ, WORKSPACE_SESSION_WRITE } = IPC_CHANNELS

  ipcMain.handle(
    WORKSPACE_SESSION_READ,
    async (_event, workspaceRoot: string): Promise<IpcResponse<WorkspaceSessionPayload>> => {
      try {
        if (!workspaceRoot || typeof workspaceRoot !== 'string') {
          return { success: false, error: 'Invalid workspace root' }
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
        writeWorkspaceSession(workspaceRoot, {
          pinnedFacts: payload.pinnedFacts ?? [],
          workingSummary: payload.workingSummary ?? null,
        })
        return { success: true, data: null }
      } catch (err) {
        return { success: false, error: String(err) }
      }
    },
  )
}
