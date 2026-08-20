import { ipcMain } from 'electron'
import path from 'path'
import { IPC_CHANNELS } from '../../shared/ipc-channels'
import type { IpcResponse, LogIndexPayload, LogReadLinesPayload } from '../../shared/types'
import {
  evictLogIndex,
  cancelLogIndexTask,
  getLogIndexAsync,
  readLogLinesAsync,
  startLogIndexTask,
} from '../services/log-index-service'

export function registerLogHandlers(): void {
  const {
    LOG_GET_INDEX,
    LOG_INDEX,
    LOG_CANCEL_INDEX,
    LOG_INDEX_EVENT,
    LOG_READ_LINES,
    LOG_EVICT_INDEX,
  } = IPC_CHANNELS

  ipcMain.handle(
    LOG_GET_INDEX,
    async (_event, filePath: string): Promise<IpcResponse<LogIndexPayload>> => {
      try {
        if (!filePath || typeof filePath !== 'string') {
          return { success: false, error: 'Invalid file path' }
        }
        const index = await getLogIndexAsync(filePath)
        return { success: true, data: index }
      } catch (err) {
        return { success: false, error: String(err) }
      }
    },
  )

  ipcMain.handle(
    LOG_INDEX,
    async (event, filePath: string): Promise<IpcResponse<{ taskId: string }>> => {
      if (!filePath || typeof filePath !== 'string' || !path.isAbsolute(filePath)) {
        return { success: false, error: 'Invalid file path', code: 'INVALID_DATA' }
      }
      const task = startLogIndexTask(filePath, (payload) => {
        event.sender.send(LOG_INDEX_EVENT, payload)
      })
      return { success: true, data: task }
    },
  )

  ipcMain.handle(
    LOG_CANCEL_INDEX,
    async (_event, taskId: string): Promise<IpcResponse<{ cancelled: boolean }>> => {
      if (!taskId || typeof taskId !== 'string') {
        return { success: false, error: 'Invalid log index task', code: 'INVALID_DATA' }
      }
      return { success: true, data: { cancelled: cancelLogIndexTask(taskId) } }
    },
  )

  ipcMain.handle(
    LOG_READ_LINES,
    async (
      _event,
      filePath: string,
      offset = 0,
      limit = 500,
    ): Promise<IpcResponse<LogReadLinesPayload>> => {
      try {
        if (!filePath || typeof filePath !== 'string') {
          return { success: false, error: 'Invalid file path' }
        }
        const result = await readLogLinesAsync(filePath, offset, limit)
        return {
          success: true,
          data: {
            path: filePath,
            startLine: result.startLine,
            endLine: result.endLine,
            totalLines: result.totalLines,
            lines: result.lines,
          },
        }
      } catch (err) {
        return { success: false, error: String(err) }
      }
    },
  )

  ipcMain.handle(LOG_EVICT_INDEX, async (_event, filePath: string): Promise<IpcResponse<null>> => {
    try {
      if (filePath && typeof filePath === 'string') {
        evictLogIndex(filePath)
      }
      return { success: true, data: null }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })
}
