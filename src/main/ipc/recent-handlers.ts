import fs from 'fs'
import path from 'path'
import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '../../shared/ipc-channels'
import { listRecentItems, recordRecentItem, removeRecentItem } from '../services/recent-service'

export function registerRecentHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.RECENT_LIST, () => ({ success: true, data: listRecentItems() }))
  ipcMain.handle(IPC_CHANNELS.RECENT_RECORD, (_event, itemPath: string, kind: 'file' | 'folder') => {
    if (typeof itemPath !== 'string' || (kind !== 'file' && kind !== 'folder')) return { success: false, error: 'Invalid recent item' }
    const resolvedPath = path.resolve(itemPath)
    if (!fs.existsSync(resolvedPath)) return { success: false, error: 'Recent item does not exist' }
    recordRecentItem(resolvedPath, kind)
    return { success: true }
  })
  ipcMain.handle(IPC_CHANNELS.RECENT_REMOVE, (_event, itemPath: string) => {
    if (typeof itemPath !== 'string') return { success: false, error: 'Invalid recent item' }
    removeRecentItem(itemPath)
    return { success: true }
  })
}
