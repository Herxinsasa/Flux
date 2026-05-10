import { useState, useCallback, useRef, useEffect } from 'react'
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
import { useSettingsStore } from '../../stores/settingsStore'
import { useFileStore } from '../../stores/fileStore'
import { JsonContextMenu } from './JsonContextMenu'
import { SearchPanel } from './SearchPanel'

/* ── Lightweight context menu for quote-to-chat in non-JSON editor modes ── */

function QuoteContextMenu({
  x,
  y,
  onClose,
  onQuote,
}: {
  x: number
  y: number
  onClose: () => void
  onQuote: () => void
}) {
  const menuRef = useRef<HTMLDivElement>(null)
  const [adjustedPos, setAdjustedPos] = useState<{ x: number; y: number } | null>(null)

  useEffect(() => {
    if (!menuRef.current) {
      setAdjustedPos({ x, y })
      return
    }
    const rect = menuRef.current.getBoundingClientRect()
    const vw = window.innerWidth
    const vh = window.innerHeight
    let ax = x
    let ay = y
    if (x + rect.width > vw) ax = vw - rect.width - 8
    if (y + rect.height > vh) ay = vh - rect.height - 8
    if (ax < 0) ax = 8
    setAdjustedPos({ x: ax, y: ay })
  }, [x, y])

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handler)
    }, 0)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('mousedown', handler)
    }
  }, [onClose])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  const handleQuote = () => {
    onQuote()
    onClose()
  }

  return (
    <>
      <div
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          zIndex: 9999,
        }}
        onClick={onClose}
        onContextMenu={(e) => {
          e.preventDefault()
          onClose()
        }}
      />
      <div
        ref={menuRef}
        className="context-menu"
        style={{
          position: 'fixed',
          zIndex: 10000,
          ...(adjustedPos ? { left: adjustedPos.x, top: adjustedPos.y } : { left: x, top: y }),
        }}
      >
        <div
          className="context-menu-item"
          onClick={handleQuote}
          role="menuitem"
        >
          引用到对话
        </div>
      </div>
    </>
  )
}

/* ── Main editor pane ────────────────────────────────────────────── */

export interface EditorPaneProps {
  /** 在 Markdown 单栏内嵌编辑器时隐藏顶部文件名条，避免与外层工具栏重复 */
  hideFileBar?: boolean
  /** 暴露底层 CodeMirror 实例，供外部监听真实滚动容器 */
  onEditorViewChange?: (view: EditorView | null) => void
}

export function EditorPane({ hideFileBar = false, onEditorViewChange }: EditorPaneProps) {
  const { extensions, handleChange } = useEditor()
  const content = useEditorStore((s) => s.content)
  const isDirty = useEditorStore((s) => s.isDirty)
  const mode = useEditorStore((s) => s.mode)
  const cursorLine = useEditorStore((s) => s.cursorLine)
  const theme = useSettingsStore((s) => s.theme)
  const currentFileName = useFileStore((s) => {
    const f = s.files.find((x) => x.path === s.currentFile)
    return f?.name ?? null
  })

  const menuUiTick = useEditorStore((s) => s.menuUiTick)
  const pendingInsertTick = useEditorStore((s) => s.pendingInsertTick)
  const jumpOutlineTick = useEditorStore((s) => s.jumpOutlineTick)
  const jumpOutlineLine = useEditorStore((s) => s.jumpOutlineLine)
  const changeHighlightTick = useEditorStore((s) => s.changeHighlightTick)
  const changeHighlightStartLine = useEditorStore((s) => s.changeHighlightStartLine)
  const changeHighlightEndLine = useEditorStore((s) => s.changeHighlightEndLine)

  const [editorView, setEditorView] = useState<EditorView | null>(null)
  const [cursorPos, setCursorPos] = useState({ line: 1, col: 1 })
  const [showSearch, setShowSearch] = useState(false)
  const [fontSize, setFontSize] = useState(14)
  const editorRef = useRef<ReactCodeMirrorRef>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const MIN_FONT_SIZE = 10
  const MAX_FONT_SIZE = 32
  const DEFAULT_FONT_SIZE = 14

  // Track last cursorLine we jumped to, to avoid re-jumping on re-renders
  const lastJumpedLineRef = useRef<number>(0)

  // JSON context menu state
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; hasSelection: boolean } | null>(null)
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
      // Scroll the target line into view centered
      editorView.dispatch({
        effects: EV.scrollIntoView(lineObj.from, { y: 'center' }),
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
        effects: EV.scrollIntoView(lineObj.from, { y: 'center' }),
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
    }
  }, [currentFileName])

  // Right-click handler — show context menu based on mode and selection
  const handleEditorContextMenu = useCallback(
    (e: React.MouseEvent) => {
      const hasSelection = !editorView?.state.selection.main.empty
      if (mode === 'json') {
        e.preventDefault()
        setContextMenu({ x: e.clientX, y: e.clientY, hasSelection: !!hasSelection })
      } else if (hasSelection) {
        e.preventDefault()
        setContextMenu({ x: e.clientX, y: e.clientY, hasSelection: true })
      }
    },
    [mode, editorView],
  )

  // Track editor view from the ref
  useEffect(() => {
    if (editorRef.current?.view) {
      setEditorView(editorRef.current.view)
    }
  }, [content]) // re-bind when content changes (new editor instance)

  // Ctrl+F / Ctrl+Plus / Ctrl+Minus / Ctrl+0 快捷键
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault()
        setShowSearch(true)
      }
      // Ctrl+Plus / Ctrl+= 放大
      if ((e.ctrlKey || e.metaKey) && (e.key === '+' || e.key === '=')) {
        e.preventDefault()
        setFontSize((prev) => Math.min(MAX_FONT_SIZE, prev + 1))
      }
      // Ctrl+Minus 缩小
      if ((e.ctrlKey || e.metaKey) && e.key === '-') {
        e.preventDefault()
        setFontSize((prev) => Math.max(MIN_FONT_SIZE, prev - 1))
      }
      // Ctrl+0 重置
      if ((e.ctrlKey || e.metaKey) && e.key === '0') {
        e.preventDefault()
        setFontSize(DEFAULT_FONT_SIZE)
      }
      if (e.key === 'Escape' && showSearch) {
        setShowSearch(false)
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [showSearch])

  // onCreateEditor gives us the view immediately
  const handleCreateEditor = useCallback(
    (view: EditorView) => {
      setEditorView(view)
    },
    [],
  )

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

  /* 菜单栏：段落插入 */
  useEffect(() => {
    const text = useEditorStore.getState().pendingInsert
    if (!text) return
    if (!editorView) {
      useEditorStore.getState().clearPendingInsert()
      return
    }
    const { from, to } = editorView.state.selection.main
    editorView.dispatch({
      changes: { from, to, insert: text },
    })
    useEditorStore.getState().clearPendingInsert()
  }, [pendingInsertTick, editorView])

  // Sync selection highlight to editor store
  useSelectionHighlight(editorView)

  // Track cursor position from CM6 updates
  const handleUpdate = useCallback((update: ViewUpdate) => {
    const head = update.state.selection.main.head
    const line = update.state.doc.lineAt(head)
    setCursorPos({
      line: line.number,
      col: head - line.from + 1,
    })
  }, [])

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
      >
        {/* 自定义搜索面板 */}
        {showSearch && <SearchPanel view={editorView} onClose={() => setShowSearch(false)} />}

        <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
          <CodeMirror
            ref={editorRef}
            value={content}
            onChange={handleChange}
            onUpdate={handleUpdate}
            onCreateEditor={handleCreateEditor}
            extensions={[...extensions]}
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
              content
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
          <span>
            第 {cursorPos.line} 行，第 {cursorPos.col} 列
          </span>
          <span style={{ color: isDirty ? 'var(--warning)' : 'var(--text-hint)' }}>
            {isDirty ? '未保存' : '已保存'}
          </span>
          <span style={{ color: 'var(--text-hint)' }}>{EDITOR_MODE_LABEL[mode]}</span>
        </div>
        <span style={{ color: 'var(--text-hint)', fontSize: '11px' }} title="Ctrl+Plus 放大，Ctrl+Minus 缩小，Ctrl+0 重置">
          字体 {fontSize}px
        </span>
      </div>

      {/* Context menu for non-JSON modes with selection: quote-only */}
      {mode !== 'json' && contextMenu?.hasSelection && (
        <QuoteContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={closeContextMenu}
          onQuote={quoteSelectionToChat}
        />
      )}

      {/* JSON context menu — includes "引用到对话" when selection exists */}
      {mode === 'json' && contextMenu && (
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
