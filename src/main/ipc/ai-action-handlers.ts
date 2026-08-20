import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '../../shared/ipc-channels'
import type { AiActionRequest, AiActionRunResult } from '../../shared/ai-action'
import type { IpcResponse } from '../../shared/types'
import { cancelAiAction, runAiAction } from '../services/ai-action-service'

export function registerAiActionHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.AI_ACTION_RUN, async (_event, request: AiActionRequest): Promise<IpcResponse<AiActionRunResult>> => {
    try {
      return { success: true, data: await runAiAction(request) }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return { success: false, code: message.includes('取消') ? 'CANCELLED' : 'INVALID_DATA', error: message }
    }
  })
  ipcMain.handle(IPC_CHANNELS.AI_ACTION_CANCEL, async (_event, sourcePath: string, requestId: string): Promise<IpcResponse<{ cancelled: boolean }>> => ({
    success: true,
    data: { cancelled: cancelAiAction(sourcePath, requestId) },
  }))
}
