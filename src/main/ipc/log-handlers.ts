import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '../../shared/ipc-channels'
import type { IpcResponse, LogIndexPayload, LogReadLinesPayload } from '../../shared/types'
import {
  evictLogIndex,
  getLogIndex,
  readLogLines,
} from '../services/log-index-service'

export function registerLogHandlers(): void {
  const { LOG_GET_INDEX, LOG_READ_LINES, LOG_EVICT_INDEX } = IPC_CHANNELS

  ipcMain.handle(
    LOG_GET_INDEX,
    async (_event, filePath: string): Promise<IpcResponse<LogIndexPayload>> => {
      try {
        if (!filePath || typeof filePath !== 'string') {
          return { success: false, error: 'Invalid file path' }
        }
        const index = getLogIndex(filePath)
        return { success: true, data: index }
      } catch (err) {
        return { success: false, error: String(err) }
      }
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
        const result = readLogLines(filePath, offset, limit)
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
