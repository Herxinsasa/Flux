import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '../../shared/ipc-channels'
import { IpcResponse } from '../../shared/types'
import { saveReportFile } from '../services/export-service'

export function registerExportHandlers(): void {
  ipcMain.handle(
    IPC_CHANNELS.EXPORT_REPORT,
    async (
      _event,
      content: string,
      defaultName: string,
    ): Promise<IpcResponse<string | null>> => {
      try {
        const filePath = await saveReportFile(content, defaultName)
        return { success: true, data: filePath }
      } catch (err) {
        return { success: false, error: String(err) }
      }
    },
  )
}
