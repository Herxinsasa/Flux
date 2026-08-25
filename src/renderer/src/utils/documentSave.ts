import { normalizeDocumentPath, useEditorStore } from '../stores/editorStore'
import { flushPendingEditorDraft } from './editorDraftBuffer'
import { discardDocumentBackup } from './documentBackup'

export function getSaveErrorMessage(code?: string, error?: string): string {
  if (code === 'VERSION_CONFLICT') return '文件已在外部修改，未覆盖原文件'
  return error ? `保存失败：${error}` : '保存失败，请稍后重试'
}

async function reloadDocumentFromDisk(filePath: string): Promise<boolean> {
  const response = await window.electronAPI.file.readText(filePath)
  if (!response?.success || !response.data) {
    window.alert(response?.error ? `重新载入失败：${response.error}` : '重新载入失败')
    return false
  }

  useEditorStore.getState().setDocumentSnapshot(filePath, response.data)
  return true
}

/** Save one captured document session without depending on the active file tab. */
export async function saveDocument(filePath?: string): Promise<boolean> {
  flushPendingEditorDraft()
  const editorState = useEditorStore.getState()
  const key = filePath ? normalizeDocumentPath(filePath) : editorState.activeDocumentPath
  const session = key ? editorState.documentSessions[key] : undefined
  if (!session?.snapshot || session.sampled || session.mode === 'log') return false

  const savedContent = session.draft
  const savedGeneration = session.editGeneration ?? 0
  const { encoding, lineEnding, version: expectedVersion } = session.snapshot
  let res: Awaited<ReturnType<typeof window.electronAPI.file.saveText>>
  try {
    res = await window.electronAPI.file.saveText({
      filePath: session.filePath,
      content: savedContent,
      encoding,
      lineEnding,
      expectedVersion,
    })
  } finally {
    await discardDocumentBackup(session.filePath)
  }
  if (res?.success && res.data) {
    useEditorStore.getState().commitSavedDocument(
      session.filePath,
      savedContent,
      res.data.version,
      savedGeneration,
    )
    return true
  }

  if (res?.code === 'VERSION_CONFLICT') {
    const reload = window.confirm(
      '文件已在外部修改，Flux 未覆盖磁盘文件。\n\n是否放弃 Flux 中的未保存内容并重新载入磁盘版本？',
    )
    if (reload) await reloadDocumentFromDisk(session.filePath)
    return false
  }

  const message = getSaveErrorMessage(res?.code, res?.error)
  console.error('Save failed:', res?.code ?? res?.error ?? 'unknown error')
  window.alert(message)
  return false
}

export const saveActiveDocument = (): Promise<boolean> => saveDocument()
