import { useCallback, useEffect, useRef } from 'react'
import { useEditorStore } from '../stores/editorStore'
import { useChatStore } from '../stores/chatStore'
import { useFileStore } from '../stores/fileStore'
import { confirmUnsavedDocument } from '../utils/unsavedChangesGuard'

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
  const previewFilePathsRef = useRef(new Map<string, string>())
  const setCursorLine = useEditorStore((s) => s.setCursorLine)
  const appendQuote = useChatStore((s) => s.appendQuote)
  const setCurrentFile = useFileStore((s) => s.setCurrentFile)

  /* ── 1. Jump editor cursor to a specific line ─────────────────── */

  const jumpToLine = useCallback(
    async (line: number, filePath?: string) => {
      // If a different file is referenced, switch to it first
      if (filePath) {
        const currentFile = useFileStore.getState().currentFile
        if (currentFile !== filePath) {
          const switched = await setCurrentFile(filePath)
          if (!switched) return
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
      const typed = result as EditorBridgeResult<PreviewChangeData>
      if (typed.success && typed.data) {
        previewFilePathsRef.current.set(typed.data.changeId, typed.data.filePath)
      }
      return typed
    },
    [],
  )

  /* ── 4. Apply (confirm) a previewed change ────────────────────── */

  const applyChange = useCallback(async (changeId: string) => {
    const targetPath = previewFilePathsRef.current.get(changeId)
    if (targetPath && !(await confirmUnsavedDocument(targetPath))) {
      return { success: false, error: '已取消 AI 修改，未覆盖未保存内容' } as EditorBridgeResult<ApplyChangeData>
    }
    const result = (await window.electronAPI.editor.applyChange(changeId)) as EditorBridgeResult<ApplyChangeData>
    previewFilePathsRef.current.delete(changeId)
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
    previewFilePathsRef.current.delete(changeId)
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
      void (async () => {
        const currentFile = useFileStore.getState().currentFile
        if (currentFile !== payload.filePath) {
          if (!(await confirmUnsavedDocument(payload.filePath))) return
          const switched = await useFileStore.getState().setCurrentFile(payload.filePath)
          if (!switched) return
        } else {
          const state = useEditorStore.getState()
          const session = state.activeDocumentPath ? state.documentSessions[state.activeDocumentPath] : undefined
          if (session?.dirty && state.content !== payload.content) return
        }

        await useFileStore.getState().loadFileContent(payload.filePath, true)
        if (payload.changed && useFileStore.getState().currentFile === payload.filePath) {
          useEditorStore
            .getState()
            .requestHighlightChangedLines(payload.startLine, payload.endLine)
        }
      })()
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
