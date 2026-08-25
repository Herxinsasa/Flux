type BackupDiscardListener = (filePath: string) => void

const backupDiscardListeners = new Set<BackupDiscardListener>()

export function subscribeDocumentBackupDiscard(listener: BackupDiscardListener): () => void {
  backupDiscardListeners.add(listener)
  return () => {
    backupDiscardListeners.delete(listener)
  }
}

export async function discardDocumentBackup(filePath: string): Promise<void> {
  try {
    const result = await window.electronAPI.backup.discardSource(filePath)
    if (!result.success) {
      console.warn('Backup cleanup failed:', result.error ?? 'unknown error')
      return
    }
    backupDiscardListeners.forEach((listener) => listener(filePath))
  } catch (error) {
    console.warn('Backup cleanup failed:', error)
  }
}
