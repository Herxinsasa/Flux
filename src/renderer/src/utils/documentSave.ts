import { normalizeDocumentPath, useEditorStore } from '../stores/editorStore'
import { flushPendingEditorDraft } from './editorDraftBuffer'

export function getSaveErrorMessage(code?: string, error?: string): string {
  if (code === 'VERSION_CONFLICT') return '文件已在外部修改，未覆盖原文件'
  return error ? `保存失败：${error}` : '保存失败，请稍后重试'
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
  const res = await window.electronAPI.file.saveText({
    filePath: session.filePath,
    content: savedContent,
    encoding,
    lineEnding,
    expectedVersion,
  })
  if (res?.success && res.data) {
    useEditorStore.getState().commitSavedDocument(
      session.filePath,
      savedContent,
      res.data.version,
      savedGeneration,
    )
    return true
  }

  const message = getSaveErrorMessage(res?.code, res?.error)
  console.error('Save failed:', res?.code ?? res?.error ?? 'unknown error')
  window.alert(message)
  return false
}

export const saveActiveDocument = (): Promise<boolean> => saveDocument()
