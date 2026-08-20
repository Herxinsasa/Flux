import { normalizeDocumentPath, useEditorStore } from '../stores/editorStore'
import { saveDocument } from './documentSave'

export type UnsavedDecision = 'save' | 'saved' | 'discard' | 'cancel'
export type UnsavedPrompt = (filePath: string) => Promise<UnsavedDecision>

let promptHandler: UnsavedPrompt | null = null

export function registerUnsavedPrompt(handler: UnsavedPrompt): () => void {
  promptHandler = handler
  return () => {
    if (promptHandler === handler) promptHandler = null
  }
}

async function requestDecision(filePath: string): Promise<UnsavedDecision> {
  if (promptHandler) return promptHandler(filePath)
  return window.confirm('当前文件有未保存修改，继续操作会丢失这些更改。是否继续？')
    ? 'discard'
    : 'cancel'
}

export async function confirmUnsavedDocument(filePath: string): Promise<boolean> {
  const key = normalizeDocumentPath(filePath)
  if (useEditorStore.getState().documentSessions[key]?.dirty !== true) return true

  const decision = await requestDecision(filePath)
  if (decision === 'cancel') return false
  if (decision === 'saved') return true
  if (decision === 'save') return saveDocument(filePath)
  useEditorStore.getState().discardDocumentChanges(filePath)
  return true
}

export function listDirtyDocumentPaths(): string[] {
  return Object.values(useEditorStore.getState().documentSessions)
    .filter((session) => session.dirty)
    .sort((a, b) => b.lastActivatedAt - a.lastActivatedAt)
    .map((session) => session.filePath)
}
