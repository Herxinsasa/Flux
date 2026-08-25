import { useState, useCallback, useRef, useEffect, useMemo } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import type { ReactCodeMirrorRef } from '@uiw/react-codemirror'
import type { EditorView, ViewUpdate } from '@codemirror/view'
import { EditorView as EV } from '@codemirror/view'
import { selectAll } from '@codemirror/commands'
import { useEditor } from '../../hooks/useEditor'
import { useSelectionHighlight } from '../../hooks/useSelectionHighlight'
import { useJsonFormat } from '../../hooks/useJsonFormat'
import { useEditorStore, EDITOR_MODE_LABEL } from '../../stores/editorStore'
import { useChatStore } from '../../stores/chatStore'
import {
  DEFAULT_READING_PREFERENCES,
  READING_CODE_FONT_SIZE_MAX,
  READING_CODE_FONT_SIZE_MIN,
  useSettingsStore,
} from '../../stores/settingsStore'
import { useLayoutStore } from '../../stores/layoutStore'
import { useFileStore } from '../../stores/fileStore'
import { JsonContextMenu } from './JsonContextMenu'
import { SearchPanel } from './SearchPanel'
import { createReviewAnchor, type ReviewAnchor } from '../../../../shared/review'
import { normalizeDocumentPath } from '../../stores/editorStore'
import { useReviewStore } from '../../stores/reviewStore'
import { reviewDecorationField, setReviewDecorations } from '../../editor/codemirror/reviewDecorations'
import { IMAGE_MIME_TYPES } from '../../../../shared/attachment-backup'
import { MarkdownContextMenu } from './MarkdownContextMenu'
import { createSourceMarkdownEdit, type MarkdownCommandId } from './sourceMarkdownCommands'
import { registerEditorDraftBuffer } from '../../utils/editorDraftBuffer'
import { WysiwygReviewComposer } from './WysiwygReviewComposer'
import { getMarkdownZoomAction } from '../../hooks/useShortcuts'
import { listenForMarkdownCommands } from './markdownCommandEvents'

/* ── Main editor pane ────────────────────────────────────────────── */

export interface EditorPaneProps {
  /** 在 Markdown 单栏内嵌编辑器时隐藏顶部文件名条，避免与外层工具栏重复 */
  hideFileBar?: boolean
  /** 暴露底层 CodeMirror 实例，供外部监听真实滚动容器 */
  onEditorViewChange?: (view: EditorView | null) => void
}

export function EditorPane({ hideFileBar = false, onEditorViewChange }: EditorPaneProps) {
  const { extensions, handleChange: commitContent } = useEditor()
  const editorExtensions = useMemo(
    () => [...extensions, reviewDecorationField],
    [extensions],
  )
  const controlledContent = useEditorStore((s) => s.mode === 'markdown' ? null : s.content)
  const isDirty = useEditorStore((s) => s.isDirty)
  const mode = useEditorStore((s) => s.mode)
  const cursorLine = useEditorStore((s) => s.cursorLine)
  const isReadOnly = useEditorStore((s) => {
    const session = s.activeDocumentPath ? s.documentSessions[s.activeDocumentPath] : undefined
    return session?.sampled === true || s.mode === 'log'
  })
  const setDocumentSelection = useEditorStore((s) => s.setDocumentSelection)
  const setDocumentScrollTop = useEditorStore((s) => s.setDocumentScrollTop)
  const theme = useSettingsStore((s) => s.theme)
  const aiConfigured = useSettingsStore((s) => s.isConfigured)
  const readingPreferences = useSettingsStore((s) => s.readingPreferences)
  const setReadingPreferences = useSettingsStore((s) => s.setReadingPreferences)
  const currentFileName = useFileStore((s) => {
    const f = s.files.find((x) => x.path === s.currentFile)
    return f?.name ?? null
  })
  const currentFile = useFileStore((s) => s.currentFile)
  const reviewPanelOpen = useReviewStore((s) => s.panelOpen)
  const reviewDocument = useReviewStore((s) => currentFile ? s.documents[normalizeDocumentPath(currentFile)] : undefined)
  const locateTick = useReviewStore((s) => s.locateTick)
  const menuUiTick = useEditorStore((s) => s.menuUiTick)
  const markdownCommandTick = useEditorStore((s) => s.markdownCommandTick)
  const jumpOutlineTick = useEditorStore((s) => s.jumpOutlineTick)
  const jumpOutlineLine = useEditorStore((s) => s.jumpOutlineLine)
  const changeHighlightTick = useEditorStore((s) => s.changeHighlightTick)
  const changeHighlightStartLine = useEditorStore((s) => s.changeHighlightStartLine)
  const changeHighlightEndLine = useEditorStore((s) => s.changeHighlightEndLine)
  const editorHydrationEpoch = useEditorStore((s) => s.editorHydrationEpoch)

  const [editorView, setEditorView] = useState<EditorView | null>(null)
  const [showSearch, setShowSearch] = useState(false)
  const [fontSize, setFontSize] = useState(readingPreferences.codeFontSize)
  const editorRef = useRef<ReactCodeMirrorRef>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const cursorLabelRef = useRef<HTMLSpanElement>(null)
  const lastSelectionRef = useRef<{ from: number; to: number } | null>(null)
  const scrollFrameRef = useRef<number | null>(null)
  const reanchorTimerRef = useRef<number | null>(null)
  const hydratingRef = useRef(false)
  const markdownValueRef = useRef(useEditorStore.getState().content)
  const pendingDraftRef = useRef<string | null>(null)
  const draftTimerRef = useRef<number | null>(null)
  const dirtyMarkedRef = useRef(useEditorStore.getState().isDirty)

  const MIN_FONT_SIZE = READING_CODE_FONT_SIZE_MIN
  const MAX_FONT_SIZE = READING_CODE_FONT_SIZE_MAX
  const DEFAULT_FONT_SIZE = DEFAULT_READING_PREFERENCES.codeFontSize

  useEffect(() => {
    setFontSize(readingPreferences.codeFontSize)
  }, [readingPreferences.codeFontSize])

  useEffect(() => {
    dirtyMarkedRef.current = isDirty
  }, [isDirty])

  // Track last cursorLine we jumped to, to avoid re-jumping on re-renders
  const lastJumpedLineRef = useRef<number>(0)

  // JSON context menu state
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; hasSelection: boolean } | null>(null)
  const [attachmentError, setAttachmentError] = useState<string | null>(null)
  const [reviewComposer, setReviewComposer] = useState<{ x: number; y: number; anchor: ReviewAnchor } | null>(null)
  const { format, compact, error, clearError } = useJsonFormat()

  const closeContextMenu = useCallback(() => {
    setContextMenu(null)
    clearError()
  }, [clearError])

  /* ── Handle line jump (from chat click) with flash highlight ── */

  const handleLineJump = useCallback(
    (line: number) => {
      if (!editorView || line <= 0) return
      const doc = editorView.state.doc
      if (line > doc.lines) return

      lastJumpedLineRef.current = line

      const lineObj = doc.line(line)
      // Scroll the target line to the top of the viewport
      editorView.dispatch({
        effects: EV.scrollIntoView(lineObj.from, { y: 'start' }),
        selection: { anchor: lineObj.from },
      })

      // Add flash-highlight class to the target line's DOM element
      const lineBlock = editorView.dom.querySelector(
        `.cm-line:nth-child(${line})`,
      ) as HTMLElement | null
      if (lineBlock) {
        lineBlock.classList.add('flash-highlight')
        const onEnd = () => {
          lineBlock.classList.remove('flash-highlight')
          lineBlock.removeEventListener('animationend', onEnd)
        }
        lineBlock.addEventListener('animationend', onEnd)
      }
    },
    [editorView],
  )

  const highlightLineRange = useCallback(
    (startLine: number, endLine: number) => {
      if (!editorView || startLine <= 0 || endLine <= 0) return
      const doc = editorView.state.doc
      const start = Math.min(startLine, endLine)
      const end = Math.max(startLine, endLine)
      const cappedEnd = Math.min(end, start + 40)
      const safeStart = Math.min(start, doc.lines)

      const lineObj = doc.line(safeStart)
      editorView.dispatch({
        effects: EV.scrollIntoView(lineObj.from, { y: 'start' }),
        selection: { anchor: lineObj.from },
      })

      for (let n = safeStart; n <= Math.min(cappedEnd, doc.lines); n++) {
        const lineBlock = editorView.dom.querySelector(
          `.cm-line:nth-child(${n})`,
        ) as HTMLElement | null
        if (!lineBlock) continue
        lineBlock.classList.add('flash-highlight')
        const onEnd = () => {
          lineBlock.classList.remove('flash-highlight')
          lineBlock.removeEventListener('animationend', onEnd)
        }
        lineBlock.addEventListener('animationend', onEnd)
      }
    },
    [editorView],
  )

  // Watch cursorLine store changes (triggered by chat link clicks)
  useEffect(() => {
    if (cursorLine > 0 && cursorLine !== lastJumpedLineRef.current) {
      handleLineJump(cursorLine)
    }
  }, [cursorLine, handleLineJump])

  // Markdown 大纲点击 → 跳转到对应源码行
  useEffect(() => {
    if (jumpOutlineTick === 0) return
    if (jumpOutlineLine > 0) {
      handleLineJump(jumpOutlineLine)
    }
  }, [jumpOutlineTick, jumpOutlineLine, handleLineJump])

  // AI 写入确认后：高亮新增/改动文本范围
  useEffect(() => {
    if (changeHighlightTick === 0) return
    if (changeHighlightStartLine > 0 && changeHighlightEndLine > 0) {
      highlightLineRange(changeHighlightStartLine, changeHighlightEndLine)
    }
  }, [
    changeHighlightTick,
    changeHighlightStartLine,
    changeHighlightEndLine,
    highlightLineRange,
  ])

  /* ── Quote selection action (shared by context menu trigger) ── */

  const quoteSelectionToChat = useCallback(() => {
    const selectedText = useEditorStore.getState().selectedText
    if (selectedText) {
      const lineRange = useEditorStore.getState().selectedLineRange
      useChatStore.getState().appendQuote({
        text: selectedText,
        range: lineRange,
        sourceLabel: currentFileName ?? undefined,
      })
      useLayoutStore.getState().showChat()
    }
  }, [currentFileName])

  const composeReview = useCallback(() => {
    if (!editorView || !currentFile || !contextMenu) return
    const selection = editorView.state.selection.main
    const anchor = createReviewAnchor(editorView.state.doc.toString(), selection.from, selection.to)
    if (anchor) setReviewComposer({ x: contextMenu.x, y: contextMenu.y, anchor })
  }, [contextMenu, currentFile, editorView])

  const runMarkdownCommand = useCallback((command: MarkdownCommandId) => {
    if (!editorView) return
    if (command === 'quote-ai') {
      quoteSelectionToChat()
      return
    }
    if (command === 'comment') {
      composeReview()
      return
    }
    const selection = editorView.state.selection.main
    const edit = createSourceMarkdownEdit(command, editorView.state.doc.toString(), selection.from, selection.to)
    if (!edit) return
    editorView.dispatch({
      changes: { from: edit.from, to: edit.to, insert: edit.insert },
      selection: edit.selection,
    })
    editorView.focus()
  }, [composeReview, editorView, quoteSelectionToChat])

  useEffect(() => {
    if (mode !== 'markdown' || isReadOnly) return
    return listenForMarkdownCommands(runMarkdownCommand)
  }, [isReadOnly, mode, runMarkdownCommand])

  const scheduleReviewReanchor = useCallback(() => {
    if (!currentFile || !reviewDocument?.sidecar.comments.length) return
    if (reanchorTimerRef.current != null) window.clearTimeout(reanchorTimerRef.current)
    reanchorTimerRef.current = window.setTimeout(() => {
      if (useFileStore.getState().currentFile === currentFile) {
        useReviewStore.getState().reanchorDocument(currentFile, useEditorStore.getState().content)
      }
    }, 400)
  }, [currentFile, reviewDocument?.sidecar.comments.length])

  const flushPendingDraft = useCallback(() => {
    if (draftTimerRef.current != null) {
      window.clearTimeout(draftTimerRef.current)
      draftTimerRef.current = null
    }
    const pending = pendingDraftRef.current
    if (pending == null) return
    pendingDraftRef.current = null
    commitContent(pending)
    scheduleReviewReanchor()
  }, [commitContent, scheduleReviewReanchor])

  const clearPendingDraft = useCallback(() => {
    if (draftTimerRef.current != null) window.clearTimeout(draftTimerRef.current)
    draftTimerRef.current = null
    pendingDraftRef.current = null
  }, [])

  useEffect(() => {
    const unregister = registerEditorDraftBuffer({ flush: flushPendingDraft, clear: clearPendingDraft })
    return () => {
      flushPendingDraft()
      unregister()
    }
  }, [clearPendingDraft, flushPendingDraft])

  const handleEditorChange = useCallback((value: string) => {
    if (hydratingRef.current) return
    markdownValueRef.current = value
    if (mode !== 'markdown') {
      commitContent(value)
      return
    }
    pendingDraftRef.current = value
    if (!dirtyMarkedRef.current) {
      dirtyMarkedRef.current = true
      useEditorStore.getState().markDocumentDirty()
    }
    if (draftTimerRef.current != null) window.clearTimeout(draftTimerRef.current)
    draftTimerRef.current = window.setTimeout(flushPendingDraft, 160)
  }, [commitContent, flushPendingDraft, mode])

  // Right-click handler — show context menu based on mode and selection
  const handleEditorContextMenu = useCallback(
    (e: React.MouseEvent) => {
      if (!editorView) return
      let selection = editorView.state.selection.main
      const position = editorView.posAtCoords({ x: e.clientX, y: e.clientY })
      if (position != null && (selection.empty || position < selection.from || position > selection.to)) {
        editorView.dispatch({ selection: { anchor: position } })
        selection = editorView.state.selection.main
      }
      const hasSelection = !selection.empty
      if (mode === 'json') {
        e.preventDefault()
        setContextMenu({ x: e.clientX, y: e.clientY, hasSelection })
      } else if (mode === 'markdown') {
        e.preventDefault()
        setContextMenu({ x: e.clientX, y: e.clientY, hasSelection })
      }
    },
    [mode, editorView],
  )

  // Ctrl+F / Ctrl+Plus / Ctrl+Minus / Ctrl+0 快捷键
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault()
        setShowSearch(true)
      }
      const zoomAction = getMarkdownZoomAction(e)
      if (mode !== 'markdown' && zoomAction) {
        e.preventDefault()
        const next = zoomAction === 'reset'
          ? DEFAULT_FONT_SIZE
          : Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, fontSize + (zoomAction === 'in' ? 1 : -1)))
        setReadingPreferences({ codeFontSize: next })
      }
      if (e.key === 'Escape' && showSearch) {
        setShowSearch(false)
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [showSearch, fontSize, mode, setReadingPreferences])

  // onCreateEditor gives us the view immediately
  const handleCreateEditor = useCallback(
    (view: EditorView) => {
      setEditorView(view)
      if (mode === 'markdown') {
        const next = useEditorStore.getState().content
        clearPendingDraft()
        dirtyMarkedRef.current = useEditorStore.getState().isDirty
        markdownValueRef.current = next
        if (view.state.doc.toString() !== next) {
          hydratingRef.current = true
          view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: next } })
          hydratingRef.current = false
        }
      }
    },
    [clearPendingDraft, mode],
  )

  useEffect(() => {
    if (!editorView || mode !== 'markdown') return
    const next = useEditorStore.getState().content
    clearPendingDraft()
    dirtyMarkedRef.current = useEditorStore.getState().isDirty
    markdownValueRef.current = next
    if (editorView.state.doc.toString() === next) return
    hydratingRef.current = true
    editorView.dispatch({ changes: { from: 0, to: editorView.state.doc.length, insert: next } })
    hydratingRef.current = false
  }, [clearPendingDraft, editorHydrationEpoch, editorView, mode])

  const insertImageFiles = useCallback(async (files: File[]) => {
    if (mode !== 'markdown' || isReadOnly || !currentFile || !editorView) return false
    const image = files.find((file) => (IMAGE_MIME_TYPES as readonly string[]).includes(file.type))
    if (!image) return false
    try {
      const bytes = new Uint8Array(await image.arrayBuffer())
      const result = await window.electronAPI.attachment.saveImage({ sourcePath: currentFile, bytes, mime: image.type, alt: image.name.replace(/\.[^.]+$/, '') })
      if (!result.success || !result.data) { setAttachmentError(result.error ?? '图片保存失败'); return true }
      const selection = editorView.state.selection.main
      editorView.dispatch({ changes: { from: selection.from, to: selection.to, insert: `![${result.data.alt}](${result.data.relativePath})` } })
      editorView.focus()
      return true
    } catch { setAttachmentError('图片保存失败，未插入引用'); return true }
  }, [currentFile, editorView, isReadOnly, mode])

  const handleImagePaste = useCallback((event: React.ClipboardEvent) => {
    const files = Array.from(event.clipboardData.files)
    if (!files.some((file) => (IMAGE_MIME_TYPES as readonly string[]).includes(file.type))) return
    event.preventDefault()
    void insertImageFiles(files)
  }, [insertImageFiles])

  const handleImageDrop = useCallback((event: React.DragEvent) => {
    const files = Array.from(event.dataTransfer.files)
    if (!files.some((file) => (IMAGE_MIME_TYPES as readonly string[]).includes(file.type))) return
    event.preventDefault()
    void insertImageFiles(files)
  }, [insertImageFiles])

  useEffect(() => {
    onEditorViewChange?.(editorView)
    return () => {
      onEditorViewChange?.(null)
    }
  }, [editorView, onEditorViewChange])

  /* 菜单栏：查找 / 全选 */
  useEffect(() => {
    const action = useEditorStore.getState().menuAction
    if (!action) return
    if (!editorView) {
      useEditorStore.getState().clearMenuAction()
      return
    }
    if (action === 'select-all') {
      selectAll(editorView)
    }
    useEditorStore.getState().clearMenuAction()
  }, [menuUiTick, editorView])

  /* 菜单栏与右键菜单共享同一 Markdown 命令。 */
  useEffect(() => {
    const command = useEditorStore.getState().markdownCommand
    if (!command) return
    if (mode !== 'markdown') {
      useEditorStore.getState().clearMarkdownCommand()
      return
    }
    if (!editorView) return
    runMarkdownCommand(command)
    useEditorStore.getState().clearMarkdownCommand()
  }, [markdownCommandTick, editorView, mode, runMarkdownCommand])

  // Sync selection highlight to editor store
  useSelectionHighlight(editorView)

  useEffect(() => () => {
    if (reanchorTimerRef.current != null) window.clearTimeout(reanchorTimerRef.current)
    if (scrollFrameRef.current != null) window.cancelAnimationFrame(scrollFrameRef.current)
  }, [])

  useEffect(() => {
    if (!editorView) return
    editorView.dispatch({ effects: setReviewDecorations.of(reviewPanelOpen ? reviewDocument?.sidecar.comments ?? [] : []) })
  }, [editorView, reviewDocument?.sidecar.comments, reviewPanelOpen])

  // 双击跳转（locateTick 驱动）：单击选中（activeCommentId）只作用于面板高亮，不触发跳转。
  // 用 ref 记录已处理的 tick，避免 reviewDocument.comments 变化（编辑 reanchor）时 effect 重跑导致误跳。
  const lastLocateTickRef = useRef(0)
  useEffect(() => {
    if (!editorView || locateTick === 0 || locateTick === lastLocateTickRef.current) return
    lastLocateTickRef.current = locateTick
    const activeCommentId = useReviewStore.getState().activeCommentId
    if (!activeCommentId) return
    const comment = reviewDocument?.sidecar.comments.find((item) => item.id === activeCommentId)
    if (!comment || comment.anchorStatus === 'orphaned' || comment.anchor.end > editorView.state.doc.length) return
    editorView.dispatch({ effects: EV.scrollIntoView(comment.anchor.start, { y: 'center' }), selection: { anchor: comment.anchor.start, head: comment.anchor.end } })
    editorView.focus()
  }, [locateTick, editorView, reviewDocument?.sidecar.comments])

  // Track cursor position from CM6 updates
  const handleUpdate = useCallback((update: ViewUpdate) => {
    const head = update.state.selection.main.head
    const line = update.state.doc.lineAt(head)
    if (cursorLabelRef.current) cursorLabelRef.current.textContent = `第 ${line.number} 行，第 ${head - line.from + 1} 列`
    const selection = update.state.selection.main
    const nextSelection = selection.empty ? null : { from: selection.from, to: selection.to }
    const previous = lastSelectionRef.current
    if (previous?.from !== nextSelection?.from || previous?.to !== nextSelection?.to) {
      lastSelectionRef.current = nextSelection
      setDocumentSelection(nextSelection ?? undefined)
    }
  }, [setDocumentSelection])

  useEffect(() => {
    if (!editorView) return
    const onScroll = () => {
      if (scrollFrameRef.current != null) return
      scrollFrameRef.current = window.requestAnimationFrame(() => {
        scrollFrameRef.current = null
        setDocumentScrollTop(editorView.scrollDOM.scrollTop)
      })
    }
    editorView.scrollDOM.addEventListener('scroll', onScroll, { passive: true })
    return () => editorView.scrollDOM.removeEventListener('scroll', onScroll)
  }, [editorView, setDocumentScrollTop])

  useEffect(() => {
    if (!editorView) return
    const state = useEditorStore.getState()
    const session = state.activeDocumentPath ? state.documentSessions[state.activeDocumentPath] : undefined
    if (!session) return
    if (session.selection) {
      const max = editorView.state.doc.length
      editorView.dispatch({ selection: { anchor: Math.min(session.selection.from, max), head: Math.min(session.selection.to, max) } })
    }
    editorView.scrollDOM.scrollTop = session.scrollTop
  }, [editorView, editorHydrationEpoch])

  return (
    <div
      ref={containerRef}
      className="editor-pane-container"
      style={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        background: 'var(--bg-viewer)',
        position: 'relative',
        fontSize: `${fontSize}px`,
        fontFamily: 'var(--font-editor)',
      }}
    >
      {/* File title bar — matches Pencil pattern */}
      {/* Log Toolbar — prototypes.pen padding 12×8, active tab card r=6, name mono 12 accent */}
      {currentFileName && !hideFileBar && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '12px 8px',
            flexShrink: 0,
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '8px 6px',
              borderRadius: 'var(--radius-sm)',
              background: 'var(--bg-card)',
            }}
          >
            <span
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 12,
                color: 'var(--accent)',
                fontWeight: 400,
              }}
            >
              {currentFileName}{isDirty ? ' *' : ''}
            </span>
          </div>
        </div>
      )}

      {/* CodeMirror editor with custom search panel */}
      <div
        style={{ flex: 1, minHeight: 0, overflow: 'hidden', position: 'relative', display: 'flex', flexDirection: 'column' }}
        onContextMenu={handleEditorContextMenu}
        onPaste={handleImagePaste}
        onDrop={handleImageDrop}
        onDragOver={(event) => { if (Array.from(event.dataTransfer.items).some((item) => (IMAGE_MIME_TYPES as readonly string[]).includes(item.type))) event.preventDefault() }}
      >
        {/* 自定义搜索面板 */}
        {showSearch && <SearchPanel view={editorView} onClose={() => setShowSearch(false)} />}
        {attachmentError && <div className="editor-inline-notice" role="status">{attachmentError}</div>}

        <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
          <CodeMirror
            ref={editorRef}
            value={controlledContent ?? markdownValueRef.current}
            onChange={handleEditorChange}
            onUpdate={handleUpdate}
            onCreateEditor={handleCreateEditor}
            extensions={editorExtensions}
            editable={!isReadOnly}
            theme={theme === 'light' ? 'light' : 'dark'}
            height="100%"
            style={{ height: '100%' }}
            indentWithTab={true}
            basicSetup={{
              lineNumbers: false,
              foldGutter: true,
              bracketMatching: true,
              closeBrackets: true,
              autocompletion: false,
              highlightSelectionMatches: false,
              search: false,
            }}
            placeholder={
              useEditorStore.getState().content
                ? undefined
                : '打开或拖入文件后开始编辑（Ctrl+O 打开）'
            }
          />
        </div>
      </div>

      {/* Status bar */}
      <div
        className="editor-statusbar"
        style={{
          height: '24px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 12px',
          background: 'var(--bg-panel)',
          borderTop: '1px solid var(--border-subtle)',
          fontFamily: 'var(--font-ui)',
          fontSize: '11px',
          color: 'var(--text-tertiary)',
          userSelect: 'none',
          flexShrink: 0,
        }}
      >
        <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
          <span ref={cursorLabelRef}>第 1 行，第 1 列</span>
          <span style={{ color: isDirty ? 'var(--warning)' : 'var(--text-hint)' }}>
            {isDirty ? '未保存' : '已保存'}
          </span>
          <span style={{ color: 'var(--text-hint)' }}>{EDITOR_MODE_LABEL[mode]}</span>
        </div>
        <span style={{ color: 'var(--text-hint)', fontSize: '11px' }} title="Ctrl+Plus 放大，Ctrl+Minus 缩小，Ctrl+0 重置">
          字体 {fontSize}px
        </span>
      </div>

      {mode === 'markdown' && contextMenu && (
        <MarkdownContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          hasSelection={contextMenu.hasSelection}
          readOnly={isReadOnly}
          aiEnabled={aiConfigured}
          commentEnabled={!!currentFile}
          onClose={closeContextMenu}
          onCommand={runMarkdownCommand}
        />
      )}

      {reviewComposer && currentFile && <WysiwygReviewComposer
        x={reviewComposer.x}
        y={reviewComposer.y}
        onCancel={() => setReviewComposer(null)}
        onSave={async (body) => {
          flushPendingDraft()
          const saved = await useReviewStore.getState().addComment(currentFile, useEditorStore.getState().content, reviewComposer.anchor, body)
          if (saved) setReviewComposer(null)
          return saved
        }}
      />}

      {/* JSON context menu — includes "引用到对话" when selection exists */}
      {mode === 'json' && contextMenu && !contextMenu.hasSelection && (
        <JsonContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={closeContextMenu}
          onFormat={format}
          onCompact={compact}
          error={error}
          onClearError={clearError}
          hasSelection={contextMenu.hasSelection}
          onQuote={quoteSelectionToChat}
        />
      )}
    </div>
  )
}
