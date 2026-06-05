import { ipcMain, shell } from 'electron'
import { IPC_CHANNELS } from '../../shared/ipc-channels'
import type { IpcResponse } from '../../shared/types'

export function registerShellHandlers(): void {
  ipcMain.handle(
    IPC_CHANNELS.SHELL_OPEN_EXTERNAL,
    async (_event, url: string): Promise<IpcResponse<null>> => {
      try {
        if (!url || typeof url !== 'string' || !/^https?:\/\//i.test(url)) {
          return { success: false, error: 'Invalid URL' }
        }
        await shell.openExternal(url)
        return { success: true, data: null }
      } catch (err) {
        return { success: false, error: String(err) }
      }
    },
  )
}
