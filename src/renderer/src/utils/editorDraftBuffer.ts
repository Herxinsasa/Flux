interface EditorDraftBuffer {
  flush: () => void
  clear: () => void
}

let activeBuffer: EditorDraftBuffer | null = null

export function registerEditorDraftBuffer(buffer: EditorDraftBuffer): () => void {
  activeBuffer = buffer
  return () => {
    if (activeBuffer === buffer) activeBuffer = null
  }
}

export function flushPendingEditorDraft(): void {
  activeBuffer?.flush()
}

export function clearPendingEditorDraft(): void {
  activeBuffer?.clear()
}
