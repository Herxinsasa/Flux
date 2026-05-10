import { useCallback, useEffect } from 'react'
import { useEditorStore } from '../stores/editorStore'
import { useChatStore } from '../stores/chatStore'
import { useFileStore } from '../stores/fileStore'

export interface LineEdit {
  startLine: number
  endLine: number
  newText: string
}

export interface PreviewChangeRequest {
  changeId: string
  filePath: string
  newContent?: string
  edits?: LineEdit[]
  transactionId?: string
}

interface EditorBridgeResult<T = unknown> {
  success: boolean
  error?: string
  data?: T
}

export interface PreviewDiffBlock {
  startLine: number
  endLine: number
  oldText: string
  newText: string
}

export interface PreviewChangeData {
  changeId: string
  transactionId: string
  filePath: string
  mode: 'full' | 'edits'
  editsCount: number
  editedLineCount: number
  changed: boolean
  startLine: number
  endLine: number
  content: string
  baseHash: string
  baseMtimeMs: number | null
  bytesBefore: number
  bytesAfter: number
  addedLines: number
  deletedLines: number
  diffBlocks: PreviewDiffBlock[]
}

interface ApplyChangeData {
  changeId: string
  transactionId?: string
  filePath: string
  content: string
  startLine: number
  endLine: number
  changed: boolean
}

/**
 * Bidirectional bridge between the editor pane and the AI chat panel.
 *
 * - jumpToLine:       Click a file:line reference in chat -> scroll editor
 * - quoteSelection:   Selected text in editor -> quote into chat input
 * - previewChange:    AI wants to write a file -> show preview in chat
 * - applyChange:      User confirms the preview -> write to file
 * - rejectChange:     User rejects the preview -> discard
 */
export function useEditorChatBridge() {
  const setCursorLine = useEditorStore((s) => s.setCursorLine)
  const setPreviewContent = useEditorStore((s) => s.setPreviewContent)
  const appendQuote = useChatStore((s) => s.appendQuote)
  const setCurrentFile = useFileStore((s) => s.setCurrentFile)

  /* ── 1. Jump editor cursor to a specific line ─────────────────── */

  const jumpToLine = useCallback(
    (line: number, filePath?: string) => {
      // If a different file is referenced, switch to it first
      if (filePath) {
        const currentFile = useFileStore.getState().currentFile
        if (currentFile !== filePath) {
          setCurrentFile(filePath)
        }
      }
      // Setting cursorLine triggers EditorPane useEffect to scroll + highlight
      setCursorLine(line)
    },
    [setCursorLine, setCurrentFile],
  )

  /* ── 2. Quote selected text into the chat input ───────────────── */

  const quoteSelection = useCallback(() => {
    const selectedText = useEditorStore.getState().selectedText
    if (selectedText) {
      const lineRange = useEditorStore.getState().selectedLineRange
      const currentPath = useFileStore.getState().currentFile
      const sourceLabel = currentPath
        ? currentPath.split(/[/\\]/).pop() ?? currentPath
        : undefined
      appendQuote({ text: selectedText, range: lineRange, sourceLabel })
    }
  }, [appendQuote])

  /* ── 3. Preview an AI-generated file change ───────────────────── */

  const previewChange = useCallback(
    async (change: PreviewChangeRequest) => {
      const result = await window.electronAPI.editor.previewChange(change)
      return result as EditorBridgeResult<PreviewChangeData>
    },
    [],
  )

  /* ── 4. Apply (confirm) a previewed change ────────────────────── */

  const applyChange = useCallback(async (changeId: string) => {
    const result = (await window.electronAPI.editor.applyChange(changeId)) as EditorBridgeResult<ApplyChangeData>
    if (result.success) {
      // Clear preview in editor
      useEditorStore.getState().setPreviewContent(null)

      if (result.data) {
        const currentFile = useFileStore.getState().currentFile
        if (currentFile === result.data.filePath) {
          // Immediate update to avoid any stale preview after confirm.
          useEditorStore.getState().setContent(result.data.content)
          useEditorStore.getState().markClean()
          useEditorStore.getState().bumpEditorHydration()
        }
        // Fallback: reload from disk to guarantee renderer/file-store consistency.
        void useFileStore.getState().loadFileContent(result.data.filePath)
      }
    }
    return result
  }, [])

  /* ── 5. Reject (discard) a previewed change ───────────────────── */

  const rejectChange = useCallback(async (changeId: string) => {
    const result = (await window.electronAPI.editor.rejectChange(changeId)) as EditorBridgeResult
    if (result.success) {
      // Clear preview in editor
      useEditorStore.getState().setPreviewContent(null)
    }
    return result
  }, [])

  const applyTransaction = useCallback(async (transactionId: string) => {
    return (await window.electronAPI.editor.applyTransaction(transactionId)) as EditorBridgeResult
  }, [])

  const rejectTransaction = useCallback(async (transactionId: string) => {
    return (await window.electronAPI.editor.rejectTransaction(transactionId)) as EditorBridgeResult
  }, [])

  // 监听主进程写入完成事件：同步内容 + 高亮新增文本区
  useEffect(() => {
    const unsub = window.electronAPI.editor.onChangeApplied((payload) => {
      const currentFile = useFileStore.getState().currentFile
      if (currentFile !== payload.filePath) {
        useFileStore.getState().setCurrentFile(payload.filePath)
      }

      useEditorStore.getState().setContent(payload.content)
      useEditorStore.getState().markClean()
      useEditorStore.getState().bumpEditorHydration()

      if (payload.changed) {
        useEditorStore
          .getState()
          .requestHighlightChangedLines(payload.startLine, payload.endLine)
      }
    })

    return () => {
      unsub()
    }
  }, [])

  return {
    jumpToLine,
    quoteSelection,
    previewChange,
    applyChange,
    rejectChange,
    applyTransaction,
    rejectTransaction,
  }
}
