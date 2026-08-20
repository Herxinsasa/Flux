import { memo, useCallback, useEffect, useRef, useState } from 'react'
import {
  Editor,
  defaultValueCtx,
  editorViewCtx,
  rootCtx,
  serializerCtx,
  type Editor as MilkdownEditor,
} from '@milkdown/kit/core'
import { commonmark } from '@milkdown/kit/preset/commonmark'
import { gfm } from '@milkdown/kit/preset/gfm'
import { tableBlock, tableBlockConfig, type RenderType } from '@milkdown/kit/component/table-block'
import { clipboard } from '@milkdown/kit/plugin/clipboard'
import { history } from '@milkdown/kit/plugin/history'
import { listener, listenerCtx } from '@milkdown/kit/plugin/listener'
import { trailing } from '@milkdown/kit/plugin/trailing'
import type { Node as ProseMirrorNode } from '@milkdown/kit/prose/model'
import type { EditorView } from '@milkdown/kit/prose/view'
import { TextSelection } from '@milkdown/kit/prose/state'
import { deleteColumn, deleteRow, selectedRect } from '@milkdown/kit/prose/tables'
import { addColAfterCommand, addRowAfterCommand, selectColCommand, setAlignCommand } from '@milkdown/kit/preset/gfm'
import { callCommand, replaceAll } from '@milkdown/kit/utils'
import { AlignCenter, AlignLeft, AlignRight, Columns3, Minus, Plus, Rows3, TableProperties } from 'lucide-react'
import '@milkdown/kit/prose/view/style/prosemirror.css'
import '@milkdown/kit/prose/tables/style/tables.css'
import './MdWysiwygEditor.css'
import type { ReviewAnchor } from '../../../../shared/review'
import { useChatStore } from '../../stores/chatStore'
import { normalizeDocumentPath, useEditorStore } from '../../stores/editorStore'
import { useFileStore } from '../../stores/fileStore'
import { useLayoutStore } from '../../stores/layoutStore'
import { useReviewStore } from '../../stores/reviewStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { MarkdownContextMenu } from './MarkdownContextMenu'
import type { MarkdownCommandId } from './sourceMarkdownCommands'
import { WysiwygReviewComposer } from './WysiwygReviewComposer'
import { WysiwygSearchPanel, wysiwygSearchPlugin } from './WysiwygSearchPanel'
import { wysiwygMarkdownInputAssist } from './wysiwygMarkdownInputAssist'
import { runWysiwygMarkdownCommand } from './wysiwygMarkdownCommands'
import { resolveSerializedReviewAnchor } from './wysiwygReviewAnchor'
import { mermaidCodeBlockView } from './mermaidCodeBlockView'
import { frontmatterNode, registerFrontmatterParsing, registerFrontmatterStringify } from './frontmatterNode'
import { wysiwygReviewDecorations, refreshWysiwygReviewDecorations } from './wysiwygReviewDecorations'
import { findTextRangeInProseMirror } from './wysiwygReviewPosition'
import { plainHeadingText } from '../../utils/markdownHeadingIds'

interface MdWysiwygEditorProps {
  fileKey: string
  onMarkdownCommit: (markdown: string) => void
  theme: 'light' | 'dark'
  outlineTarget?: {
    level: number
    text: string
    occurrence: number
    requestId: number
  } | null
}

interface WysiwygSurfaceState {
  selection: { from: number; to: number } | null
  scrollTop: number
}

const wysiwygSurfaceStates = new Map<string, WysiwygSurfaceState>()

function getEditorScrollContainer(root: HTMLElement | null): HTMLElement | null {
  return root?.closest<HTMLElement>('.flux-scroll') ?? root
}

function scrollEditorPositionIntoView(view: EditorView, root: HTMLElement | null, position: number): void {
  window.requestAnimationFrame(() => {
    const scrollContainer = getEditorScrollContainer(root)
    if (!scrollContainer) return
    const target = view.nodeDOM(position)
    const targetElement = target instanceof Element ? target : target?.parentElement
    if (targetElement) {
      const targetRect = targetElement.getBoundingClientRect()
      const containerRect = scrollContainer.getBoundingClientRect()
      scrollContainer.scrollTop += targetRect.top - containerRect.top - (containerRect.height - targetRect.height) / 2
      return
    }
    const coords = view.coordsAtPos(position)
    const containerRect = scrollContainer.getBoundingClientRect()
    scrollContainer.scrollTop += coords.top - containerRect.top - containerRect.height / 2
  })
}

/** 按内联子节点拼装标题文本：文本节点取文本、image 节点取 alt（图片无文本内容） */
function headingTextFromNode(node: ProseMirrorNode): string {
  let text = ''
  node.forEach((child) => {
    if (child.isText && child.text) text += child.text
    else if (child.type.name === 'image') text += (child.attrs.alt as string) ?? ''
  })
  return text
}

/** Markdown-first live editor. The store remains the source of truth for saving. */
function MdWysiwygEditorInner({ fileKey, onMarkdownCommit, theme, outlineTarget }: MdWysiwygEditorProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<MilkdownEditor | null>(null)
  /** 已创建完成的 editorView；editor 在 create 前/销毁后不可用，统一走此引用避免 .doc 崩溃 */
  const viewRef = useRef<EditorView | null>(null)
  /** 批注高亮订阅（view 就绪后注册，卸载时移除） */
  const unsubscribeReviewRef = useRef<(() => void) | undefined>(undefined)
  const onCommitRef = useRef(onMarkdownCommit)
  const currentFile = useFileStore((state) => state.currentFile)
  const currentFileName = useFileStore((state) => {
    const file = state.files.find((item) => item.path === state.currentFile)
    return file?.name
  })
  const aiConfigured = useSettingsStore((state) => state.isConfigured)
  const locateTick = useReviewStore((state) => state.locateTick)
  const reviewDocument = useReviewStore((state) => currentFile ? state.documents[normalizeDocumentPath(currentFile)] : undefined)
  const markdownCommandTick = useEditorStore((state) => state.markdownCommandTick)
  const isReadOnly = useEditorStore((state) => {
    const session = state.activeDocumentPath
      ? state.documentSessions[state.activeDocumentPath]
      : undefined
    return session?.sampled === true || state.mode === 'log'
  })
  const [contextMenu, setContextMenu] = useState<{
    x: number
    y: number
    hasSelection: boolean
    selectedText: string
    reviewAnchor: ReviewAnchor | null
  } | null>(null)
  const [reviewComposer, setReviewComposer] = useState<{
    x: number
    y: number
    anchor: ReviewAnchor
  } | null>(null)
  const [tableTools, setTableTools] = useState<{ left: number; top: number; rows: number; columns: number } | null>(null)
  const [tableSizeOpen, setTableSizeOpen] = useState(false)
  const [viewReady, setViewReady] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)

  // Ctrl+F 打开搜索（编辑区域）
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault()
        setSearchOpen(true)
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [])

  useEffect(() => {
    onCommitRef.current = onMarkdownCommit
  }, [onMarkdownCommit])

  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    setTableTools(null)
    setTableSizeOpen(false)

    let disposed = false
    let unsubscribeStore: (() => void) | undefined
    let scrollContainer: HTMLElement | null = null
    let lastMarkdown = useEditorStore.getState().content
    const saveSurfaceState = () => {
      const view = viewRef.current
      const currentScrollContainer = getEditorScrollContainer(root)
      if (!view) return
      wysiwygSurfaceStates.set(fileKey, {
        selection: { from: view.state.selection.from, to: view.state.selection.to },
        scrollTop: currentScrollContainer?.scrollTop ?? 0,
      })
    }
    const restoreSurfaceState = () => {
      const view = viewRef.current
      const saved = wysiwygSurfaceStates.get(fileKey)
      if (!view || !saved) return
      try {
        const maxPosition = Math.max(1, view.state.doc.content.size)
        const from = Math.min(Math.max(1, saved.selection?.from ?? 1), maxPosition)
        const to = Math.min(Math.max(from, saved.selection?.to ?? from), maxPosition)
        view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, from, to)))
      } catch {
        view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(1))))
      }
      window.requestAnimationFrame(() => {
        const currentScrollContainer = getEditorScrollContainer(root)
        if (currentScrollContainer) currentScrollContainer.scrollTop = saved.scrollTop
      })
    }

    const editor = Editor.make()
      .config((ctx) => {
        ctx.set(rootCtx, root)
        ctx.set(defaultValueCtx, lastMarkdown)
        ctx.set(tableBlockConfig.key, {
          renderButton: (type: RenderType) => ({
            add_row: '+',
            add_col: '+',
            delete_row: '−',
            delete_col: '−',
            align_col_left: 'L',
            align_col_center: 'C',
            align_col_right: 'R',
            col_drag_handle: '⋮',
            row_drag_handle: '⋯',
          })[type],
        })
        ctx.get(listenerCtx).markdownUpdated((_ctx, markdown) => {
          if (disposed || markdown === lastMarkdown) return
          lastMarkdown = markdown
          onCommitRef.current(markdown)
        })
        // frontmatter：解析（remark-frontmatter）与序列化（remark-stringify handler）对称接入，
        // 避免 `---` 被解析为 hr + setext 标题
        registerFrontmatterParsing(ctx)
        registerFrontmatterStringify(ctx)
      })
      .use(commonmark)
      .use(gfm)
      .use(tableBlock)
      .use(listener)
      .use(history)
      .use(clipboard)
      .use(trailing)
      .use(mermaidCodeBlockView)
      .use(frontmatterNode)
      .use(wysiwygReviewDecorations)
      .use(wysiwygSearchPlugin)
      .use(wysiwygMarkdownInputAssist)

    editorRef.current = editor
    void editor.create()
      .then(() => {
        if (disposed) return
        try {
          viewRef.current = editor.ctx.get(editorViewCtx)
        } catch {
          viewRef.current = null
        }
        // view 就绪后触发跳转 effect 补执行（初始化窗口期内的双击/大纲点击不再丢失）
        if (viewRef.current) {
          setViewReady(true)
          restoreSurfaceState()
          scrollContainer = getEditorScrollContainer(root)
          root.addEventListener('keyup', saveSurfaceState)
          root.addEventListener('mouseup', saveSurfaceState)
          root.addEventListener('focusout', saveSurfaceState)
          scrollContainer?.addEventListener('scroll', saveSurfaceState, { passive: true })
        }
        unsubscribeStore = useEditorStore.subscribe((state, previousState) => {
          if (state.editorHydrationEpoch === previousState.editorHydrationEpoch) return
          if (state.content === lastMarkdown) return
          lastMarkdown = state.content
          editor.action(replaceAll(state.content, true))
        })
        // 批注高亮：批注列表变化时刷新装饰
        const refreshDecorations = () => {
          if (disposed || !viewRef.current) return
          const document = useReviewStore.getState().documents[normalizeDocumentPath(currentFile ?? '')]
          refreshWysiwygReviewDecorations(viewRef.current, document?.sidecar.comments ?? [])
        }
        const unsubscribeReview = useReviewStore.subscribe((state, previousState) => {
          if (state.documents === previousState.documents) return
          refreshDecorations()
        })
        unsubscribeReviewRef.current = unsubscribeReview
        refreshDecorations()
      })
      .catch((error: unknown) => {
        if (disposed) return
        console.error('[MdWysiwygEditor] editor.create 失败', error)
      })

    return () => {
      saveSurfaceState()
      root.removeEventListener('keyup', saveSurfaceState)
      root.removeEventListener('mouseup', saveSurfaceState)
      root.removeEventListener('focusout', saveSurfaceState)
      scrollContainer?.removeEventListener('scroll', saveSurfaceState)
      disposed = true
      unsubscribeStore?.()
      unsubscribeReviewRef.current?.()
      unsubscribeReviewRef.current = undefined
      editorRef.current = null
      viewRef.current = null
      setViewReady(false)
      void editor.destroy()
    }
  }, [fileKey])

  const refreshTableTools = useCallback(() => {
    const root = rootRef.current
    if (!root) return
    const view = viewRef.current
    if (!view) return
    const { $from } = view.state.selection
    let tableDepth = -1
    for (let depth = $from.depth; depth > 0; depth -= 1) {
      if ($from.node(depth).type.name === 'table') {
        tableDepth = depth
        break
      }
    }
    if (tableDepth < 0) {
      setTableTools(null)
      setTableSizeOpen(false)
      return
    }
    const tableNode = $from.node(tableDepth)
    const tableDom = view.nodeDOM($from.before(tableDepth)) as HTMLElement | null
    const block = tableDom?.closest<HTMLElement>('.milkdown-table-block') ?? tableDom
    if (!block) return
    const rootRect = root.getBoundingClientRect()
    const tableRect = block.getBoundingClientRect()
    setTableTools({
      left: Math.max(4, tableRect.left - rootRect.left),
      top: Math.max(4, tableRect.top - rootRect.top),
      rows: tableNode.childCount,
      columns: tableNode.firstChild?.childCount ?? 0,
    })
  }, [])

  const runTableCommand = useCallback((command: 'add-row' | 'remove-row' | 'add-column' | 'remove-column' | 'left' | 'center' | 'right') => {
    const editor = editorRef.current
    if (!editor) return
    if (command === 'add-row') editor.action(callCommand(addRowAfterCommand.key))
    else if (command === 'add-column') editor.action(callCommand(addColAfterCommand.key))
    else if (command === 'left' || command === 'center' || command === 'right') {
      const view = viewRef.current
      if (!view) return
      const columnIndex = selectedRect(view.state).left
      editor.action(callCommand(selectColCommand.key, { index: columnIndex, pos: view.state.selection.from }))
      editor.action(callCommand(setAlignCommand.key, command))
    }
    else {
      const view = viewRef.current
      if (!view) return
      const proseCommand = command === 'remove-row' ? deleteRow : deleteColumn
      proseCommand(view.state, view.dispatch)
    }
    requestAnimationFrame(refreshTableTools)
  }, [refreshTableTools])

  useEffect(() => {
    if (!outlineTarget || !viewReady) return
    const view = viewRef.current
    if (!view) return
    let matchIndex = 0
    let targetPosition: number | null = null
    view.state.doc.descendants((node, position) => {
      if (targetPosition != null || node.type.name !== 'heading') return
      // 按内联子节点拼装（含图片 alt），再过同款规范化，与大纲文本对称比较
      const nodeText = plainHeadingText(headingTextFromNode(node))
      if (Number(node.attrs.level) !== outlineTarget.level || nodeText !== outlineTarget.text) return
      if (matchIndex === outlineTarget.occurrence) targetPosition = position + 1
      matchIndex += 1
    })
    if (targetPosition == null) {
      console.warn('[MdWysiwygEditor] 大纲跳转未找到匹配标题', outlineTarget)
      return
    }
    view.dispatch(
      view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(targetPosition))),
    )
    // 大纲跳转：标题滚动到可视区顶部；nodeDOM 返回 Text 节点时取其父元素
    const rawDom = view.nodeDOM(targetPosition)
    const targetDom = rawDom instanceof Element
      ? (rawDom as HTMLElement)
      : (rawDom?.parentElement ?? null)
    const scrollable = targetDom?.closest<HTMLElement>('.flux-scroll') ?? rootRef.current
    if (scrollable && targetDom) {
      scrollable.scrollTo({ top: scrollable.scrollTop + targetDom.getBoundingClientRect().top - scrollable.getBoundingClientRect().top })
    }
    view.focus()
  }, [outlineTarget, viewReady])

  useEffect(() => {
    if (!viewReady || !viewRef.current) return
    refreshWysiwygReviewDecorations(viewRef.current, reviewDocument?.sidecar.comments ?? [])
  }, [currentFile, reviewDocument?.sidecar.comments, viewReady])

  // 双击跳转（locateTick 驱动）：单击选中（activeCommentId）只作用于面板高亮，不触发跳转。
  // 用 ref 记录已处理的 tick，避免 reviewDocument.comments 变化（编辑 reanchor）时 effect 重跑导致误跳。
  const lastLocateTickRef = useRef(0)
  useEffect(() => {
    if (!viewReady || locateTick === 0 || locateTick === lastLocateTickRef.current) return
    lastLocateTickRef.current = locateTick
    const activeCommentId = useReviewStore.getState().activeCommentId
    if (!activeCommentId) return
    const comment = reviewDocument?.sidecar.comments.find((item) => item.id === activeCommentId)
    if (!comment || comment.anchorStatus === 'orphaned') return
    const view = viewRef.current
    if (!view) return
    const sourceLength = Math.max(1, useEditorStore.getState().content.length)
    const range = findTextRangeInProseMirror(
      view.state.doc,
      comment.anchor.quote,
      comment.anchor.start / sourceLength,
    )
    if (range == null) {
      console.warn('[MdWysiwygEditor] 批注定位失败', comment.id, comment.anchor.quote.slice(0, 80))
      return
    }
    const from = Math.max(1, Math.min(range.from, view.state.doc.content.size))
    const to = Math.max(from, Math.min(range.to, view.state.doc.content.size))
    view.dispatch(
      view.state.tr
        .setSelection(TextSelection.create(view.state.doc, from, to))
    )
    view.focus()
    scrollEditorPositionIntoView(view, rootRef.current, from)
  }, [locateTick, viewReady, reviewDocument?.sidecar.comments])

  useEffect(() => {
    const command = useEditorStore.getState().markdownCommand
    const editor = editorRef.current
    if (!command || !editor) return
    runWysiwygMarkdownCommand(editor, command)
    useEditorStore.getState().clearMarkdownCommand()
  }, [markdownCommandTick])

  const handleContextMenu = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    const editor = editorRef.current
    if (!editor) return
    event.preventDefault()

    const view = viewRef.current
    if (!view) return
    let selection = view.state.selection
    const position = view.posAtCoords({ left: event.clientX, top: event.clientY })
    if (position && (selection.empty || position.pos < selection.from || position.pos > selection.to)) {
      view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(position.pos))))
      selection = view.state.selection
    }

    const selectedText = selection.empty
      ? ''
      : view.state.doc.textBetween(selection.from, selection.to, '\n').trim()
    const markdown = useEditorStore.getState().content
    let reviewAnchor: ReviewAnchor | null = null
    if (!selection.empty && selectedText) {
      const markerId = `${Date.now()}${selection.from}${selection.to}`
      const startMarker = `FLUXREVIEWSTART${markerId}`
      const endMarker = `FLUXREVIEWEND${markerId}`
      const markedDoc = view.state.tr
        .insertText(endMarker, selection.to)
        .insertText(startMarker, selection.from)
        .doc
      const markedMarkdown = editor.ctx.get(serializerCtx)(markedDoc)
      reviewAnchor = resolveSerializedReviewAnchor(markdown, markedMarkdown, startMarker, endMarker)
    }

    setContextMenu({
      x: event.clientX,
      y: event.clientY,
      hasSelection: !selection.empty && !!selectedText,
      selectedText,
      reviewAnchor,
    })
  }, [])

  const runCommand = useCallback((command: MarkdownCommandId) => {
    const editor = editorRef.current
    const menu = contextMenu
    if (!editor || !menu) return

    if (command === 'quote-ai') {
      if (!aiConfigured || !menu.selectedText) return
      useChatStore.getState().appendQuote({
        text: menu.selectedText,
        range: null,
        sourceLabel: currentFileName,
      })
      useLayoutStore.getState().showChat()
      return
    }
    if (command === 'comment') {
      if (menu.reviewAnchor) {
        setReviewComposer({ x: menu.x, y: menu.y, anchor: menu.reviewAnchor })
      }
      return
    }

    runWysiwygMarkdownCommand(editor, command)
  }, [aiConfigured, contextMenu, currentFileName])

  return (
    <div
      className={`flux-milkdown-editor ${theme === 'dark' ? 'dark' : 'light'}`}
      onContextMenu={handleContextMenu}
      onClick={refreshTableTools}
      onKeyUp={refreshTableTools}
    >
      {searchOpen && viewRef.current && (
        <WysiwygSearchPanel view={viewRef.current} onClose={() => setSearchOpen(false)} />
      )}
      <div ref={rootRef} className="flux-milkdown-root" />
      {tableTools && <div className="flux-table-toolbar" contentEditable={false} style={{ left: tableTools.left, top: tableTools.top }} onMouseDown={(event) => event.preventDefault()}>
        <button type="button" title="调整行列数量" aria-expanded={tableSizeOpen} onClick={() => setTableSizeOpen((value) => !value)}><TableProperties size={16} /></button>
        <button type="button" title="左对齐" onClick={() => runTableCommand('left')}><AlignLeft size={16} /></button>
        <button type="button" title="居中" onClick={() => runTableCommand('center')}><AlignCenter size={16} /></button>
        <button type="button" title="右对齐" onClick={() => runTableCommand('right')}><AlignRight size={16} /></button>
        {tableSizeOpen && <div className="flux-table-size-popover">
          <div><Rows3 size={15} /><span>行</span><button type="button" title="减少一行" disabled={tableTools.rows <= 2} onClick={() => runTableCommand('remove-row')}><Minus size={14} /></button><output>{tableTools.rows}</output><button type="button" title="增加一行" onClick={() => runTableCommand('add-row')}><Plus size={14} /></button></div>
          <div><Columns3 size={15} /><span>列</span><button type="button" title="减少一列" disabled={tableTools.columns <= 1} onClick={() => runTableCommand('remove-column')}><Minus size={14} /></button><output>{tableTools.columns}</output><button type="button" title="增加一列" onClick={() => runTableCommand('add-column')}><Plus size={14} /></button></div>
        </div>}
      </div>}
      {contextMenu && (
        <MarkdownContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          hasSelection={contextMenu.hasSelection}
          readOnly={isReadOnly}
          aiEnabled={aiConfigured}
          commentEnabled={!!currentFile && !!contextMenu.reviewAnchor}
          onClose={() => setContextMenu(null)}
          onCommand={runCommand}
        />
      )}
      {reviewComposer && currentFile && (
        <WysiwygReviewComposer
          x={reviewComposer.x}
          y={reviewComposer.y}
          onCancel={() => setReviewComposer(null)}
          onSave={async (body) => {
            const content = useEditorStore.getState().content
            const saved = await useReviewStore.getState().addComment(
              currentFile,
              content,
              reviewComposer.anchor,
              body,
            )
            if (saved) setReviewComposer(null)
            return saved
          }}
        />
      )}
    </div>
  )
}

export const MdWysiwygEditor = memo(MdWysiwygEditorInner)
