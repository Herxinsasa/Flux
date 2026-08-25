import { BrowserWindow, dialog, ipcMain } from 'electron'
import type { SaveDialogOptions, SaveDialogReturnValue, WebContents } from 'electron'
import path from 'path'
import { IPC_CHANNELS } from '../../shared/ipc-channels'
import type { IpcResponse } from '../../shared/types'
import type { BackupSnapshotInput, SaveBackupAsRequest, SaveImageAttachmentRequest } from '../../shared/attachment-backup'
import { saveImageAttachment } from '../services/attachment-service'
import { getBackupService } from '../services/backup-service'

function responseError(error: unknown): IpcResponse {
  const candidate = error as { message?: string; code?: string }
  return { success: false, error: candidate?.message ?? String(error), code: candidate?.code as IpcResponse['code'] }
}

export function showBackupSaveDialog(sender: WebContents, options: SaveDialogOptions): Promise<SaveDialogReturnValue> {
  const owner = BrowserWindow.fromWebContents(sender) ?? BrowserWindow.getFocusedWindow()
  return owner ? dialog.showSaveDialog(owner, options) : dialog.showSaveDialog(options)
}

export function registerAttachmentBackupHandlers(): void {
  const backupService = getBackupService()
  ipcMain.handle(IPC_CHANNELS.ATTACHMENT_SAVE_IMAGE, async (_event, request: SaveImageAttachmentRequest): Promise<IpcResponse> => {
    try { return { success: true, data: await saveImageAttachment(request) } } catch (error) { return responseError(error) }
  })
  ipcMain.handle(IPC_CHANNELS.BACKUP_CREATE, async (_event, input: BackupSnapshotInput): Promise<IpcResponse> => {
    try { return { success: true, data: await backupService.create(input) } } catch (error) { return responseError(error) }
  })
  ipcMain.handle(IPC_CHANNELS.BACKUP_LIST, async (_event, sourcePath?: string): Promise<IpcResponse> => {
    try { return { success: true, data: await backupService.list(sourcePath) } } catch (error) { return responseError(error) }
  })
  ipcMain.handle(IPC_CHANNELS.BACKUP_READ, async (_event, snapshotId: string): Promise<IpcResponse> => {
    try { return { success: true, data: await backupService.read(snapshotId) } } catch (error) { return responseError(error) }
  })
  ipcMain.handle(IPC_CHANNELS.BACKUP_RECOVERIES, async (_event, sourcePath?: string): Promise<IpcResponse> => {
    try { return { success: true, data: await backupService.findRecoveryCandidates(sourcePath) } } catch (error) { return responseError(error) }
  })
  ipcMain.handle(IPC_CHANNELS.BACKUP_DISCARD, async (_event, snapshotId: string): Promise<IpcResponse> => {
    try { return { success: true, data: { discarded: await backupService.discard(snapshotId) } } } catch (error) { return responseError(error) }
  })
  ipcMain.handle(IPC_CHANNELS.BACKUP_DISCARD_SOURCE, async (_event, sourcePath: string): Promise<IpcResponse> => {
    try { return { success: true, data: { discarded: await backupService.discardSource(sourcePath) } } } catch (error) { return responseError(error) }
  })
  ipcMain.handle(IPC_CHANNELS.BACKUP_SAVE_AS, async (event, request: SaveBackupAsRequest): Promise<IpcResponse> => {
    try {
      const snapshot = await backupService.read(request.snapshotId)
      if (!snapshot) return { success: false, error: 'Backup snapshot not found', code: 'NOT_FOUND' }
      const selected = await showBackupSaveDialog(event.sender, {
        title: '另存恢复内容', defaultPath: path.basename(snapshot.sourcePath),
      })
      if (selected.canceled || !selected.filePath) return { success: true, data: { cancelled: true } }
      await backupService.saveAs({ snapshotId: request.snapshotId, targetPath: selected.filePath })
      return { success: true, data: { targetPath: selected.filePath } }
    } catch (error) { return responseError(error) }
  })
}
