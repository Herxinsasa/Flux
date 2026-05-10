import { useCallback, useEffect, useRef, useState, useDeferredValue, memo } from 'react'
import type { EditorView } from '@codemirror/view'
import { useEditorStore } from '../../stores/editorStore'
import { useFileStore } from '../../stores/fileStore'
import { EditorPane } from './EditorPane'
import { MdPreview } from './MdPreview'
import { MdOutlinePanel } from './MdOutlinePanel'
import { findNearestHeadingIdForLine, type MdOutlineItem } from '../../utils/markdownHeadingIds'

/** 分栏视图 — 左源码驱动右预览；右侧手动滚动可暂停同步，标题/光标变化时重新对齐 */
function SplitView({ sourceContent }: { sourceContent: string }) {
  const cursorLine = useEditorStore((s) => s.cursorLine)
  const jumpOutlineTick = useEditorStore((s) => s.jumpOutlineTick)
  const jumpOutlineLine = useEditorStore((s) => s.jumpOutlineLine)

  const rightRef = useRef<HTMLDivElement>(null)
  const programmaticPreviewScrollRef = useRef(false)
  const lastAlignedHeadingIdRef = useRef<string | null>(null)
  const previewSyncPausedRef = useRef(false)

  const [sourceView, setSourceView] = useState<EditorView | null>(null)
  const [previewSyncPaused, setPreviewSyncPaused] = useState(false)
  const [scrollTarget, setScrollTarget] = useState<{ id: string | null; key: number }>({ id: null, key: 0 })

  useEffect(() => {
    previewSyncPausedRef.current = previewSyncPaused
  }, [previewSyncPaused])

  const markProgrammaticPreviewScroll = useCallback(() => {
    programmaticPreviewScrollRef.current = true
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        programmaticPreviewScrollRef.current = false
      })
    })
  }, [])

  const syncPreviewToSourceScroll = useCallback(() => {
    if (previewSyncPausedRef.current || !sourceView || !rightRef.current) return

    const sourceScrollEl = sourceView.scrollDOM
    const previewScrollEl = rightRef.current
    const sourceScrollable = sourceScrollEl.scrollHeight - sourceScrollEl.clientHeight
    const previewScrollable = previewScrollEl.scrollHeight - previewScrollEl.clientHeight
    if (sourceScrollable <= 0 || previewScrollable <= 0) return

    markProgrammaticPreviewScroll()
    previewScrollEl.scrollTop = (sourceScrollEl.scrollTop / sourceScrollable) * previewScrollable
  }, [markProgrammaticPreviewScroll, sourceView])

  const realignPreviewToLine = useCallback(
    (line: number, force = false) => {
      const headingId = findNearestHeadingIdForLine(sourceContent, line)
      if (!headingId) return
      if (!force && !previewSyncPaused && headingId === lastAlignedHeadingIdRef.current) return

      lastAlignedHeadingIdRef.current = headingId
      setPreviewSyncPaused(false)
      markProgrammaticPreviewScroll()
      setScrollTarget((prev) => ({ id: headingId, key: prev.key + 1 }))
    },
    [markProgrammaticPreviewScroll, previewSyncPaused, sourceContent],
  )

  useEffect(() => {
    if (!sourceView) return

    const sourceScrollEl = sourceView.scrollDOM
    const handleSourceScroll = () => {
      if (previewSyncPausedRef.current) {
        previewSyncPausedRef.current = false
        setPreviewSyncPaused(false)
      }
      syncPreviewToSourceScroll()
    }

    sourceScrollEl.addEventListener('scroll', handleSourceScroll, { passive: true })
    return () => sourceScrollEl.removeEventListener('scroll', handleSourceScroll)
  }, [sourceView, syncPreviewToSourceScroll])

  useEffect(() => {
    syncPreviewToSourceScroll()
  }, [sourceContent, syncPreviewToSourceScroll])

  useEffect(() => {
    if (cursorLine <= 0) return
    realignPreviewToLine(cursorLine, previewSyncPaused)
  }, [cursorLine, previewSyncPaused, realignPreviewToLine])

  useEffect(() => {
    if (jumpOutlineTick === 0 || jumpOutlineLine <= 0) return
    realignPreviewToLine(jumpOutlineLine, true)
  }, [jumpOutlineLine, jumpOutlineTick, realignPreviewToLine])

  const handlePreviewScroll = useCallback(() => {
    if (programmaticPreviewScrollRef.current) return
    setPreviewSyncPaused(true)
  }, [])

  return (
    <div style={{
      flex: 1,
      minHeight: 0,
      display: 'flex',
      flexDirection: 'row',
      overflow: 'hidden',
    }}>
      {/* 源码（左）— 真实滚动体在 CodeMirror 内部 scroller */}
      <div
        className="markdown-split-left"
        style={{
          flex: 1,
          minWidth: 0,
          overflow: 'hidden',
          borderRight: '1px solid var(--border-subtle)',
        }}
      >
        <EditorPane hideFileBar onEditorViewChange={setSourceView} />
      </div>
      {/* 预览（右）— 可见滚动条；用户手动滚动时暂停跟随 */}
      <div
        ref={rightRef}
        className="markdown-split-right flux-scroll"
        onScroll={handlePreviewScroll}
        style={{
          flex: 1,
          minWidth: 0,
          overflow: 'auto',
          background: 'var(--bg-viewer)',
        }}
      >
        <MdPreview
          content={sourceContent}
          scrollable={false}
          scrollToHeadingId={scrollTarget.id}
          scrollRequestKey={scrollTarget.key}
        />
      </div>
    </div>
  )
}

/** 仅在大纲打开时挂载，避免关闭时仍随按键订阅全文；useDeferredValue 缓解解析与渲染抢占 */
const MarkdownOutlineAside = memo(function MarkdownOutlineAside({
  onPick,
}: {
  onPick: (item: MdOutlineItem) => void
}) {
  const rawContent = useEditorStore((s) => s.content)
  const outlineMarkdown = useDeferredValue(rawContent)
  return (
    <div
      className="flex flex-col min-h-0 shrink-0 overflow-hidden"
      style={{
        width: 220,
        borderLeft: '1px solid var(--border-subtle)',
        background: 'var(--bg-panel)',
      }}
    >
      <MdOutlinePanel content={outlineMarkdown} onPick={onPick} />
    </div>
  )
})

export function MarkdownEditor() {
  const markdownEditSurface = useEditorStore((s) => s.markdownEditSurface)
  const isDirty = useEditorStore((s) => s.isDirty)
  const setMarkdownEditSurface = useEditorStore((s) => s.setMarkdownEditSurface)
  const requestJumpToOutlineLine = useEditorStore((s) => s.requestJumpToOutlineLine)

  const currentFile = useFileStore((s) => s.currentFile)
  const currentFileName = useFileStore((s) => {
    const f = s.files.find((x) => x.path === s.currentFile)
    return f?.name ?? null
  })

  const [outlineOpen, setOutlineOpen] = useState(false)
  const [previewZoom, setPreviewZoom] = useState(1)
  const zoomLayerRef = useRef<HTMLDivElement>(null)
  const pendingOutlineLineRef = useRef<number | null>(null)

  useEffect(() => {
    setMarkdownEditSurface('wysiwyg')
    setOutlineOpen(false)
    setPreviewZoom(1)
  }, [currentFile, setMarkdownEditSurface])

  useEffect(() => {
    if (markdownEditSurface === 'wysiwyg') return
    const line = pendingOutlineLineRef.current
    if (line == null) return
    pendingOutlineLineRef.current = null
    requestJumpToOutlineLine(line)
  }, [markdownEditSurface, requestJumpToOutlineLine])

  useEffect(() => {
    const el = zoomLayerRef.current
    if (!el) return
    const wheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return
      e.preventDefault()
      setPreviewZoom((z) => {
        const delta = e.deltaY > 0 ? -0.06 : 0.06
        return Math.min(2.2, Math.max(0.55, Math.round((z + delta) * 100) / 100))
      })
    }
    el.addEventListener('wheel', wheel, { passive: false })
    return () => el.removeEventListener('wheel', wheel)
  }, [markdownEditSurface])

  const onOutlinePick = useCallback(
    (item: MdOutlineItem) => {
      if (markdownEditSurface === 'wysiwyg') {
        pendingOutlineLineRef.current = item.line
        setMarkdownEditSurface('split')
      } else {
        requestJumpToOutlineLine(item.line)
      }
    },
    [markdownEditSurface, setMarkdownEditSurface, requestJumpToOutlineLine],
  )

  const tabBtn = (active: boolean) =>
    `px-2 py-1 rounded-[var(--radius-sm)] text-app-sm border-0 cursor-pointer font-[var(--font-ui)] ${
      active
        ? 'bg-[var(--selection)] text-[var(--text-primary)]'
        : 'text-[var(--text-secondary)] hover:bg-[var(--hover)] bg-transparent'
    }`

  const sourceContent = useEditorStore((s) => s.content)

  return (
    <div
      className="markdown-editor-container"
      style={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '10px 8px',
          borderBottom: '1px solid var(--border-subtle)',
          background: 'var(--bg-viewer)',
          flexWrap: 'wrap',
        }}
      >
        {currentFileName && (
          <span
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 12,
              color: 'var(--accent)',
              marginRight: 4,
              maxWidth: 200,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
            title={currentFile ?? undefined}
          >
            {currentFileName}{isDirty ? ' *' : ''}
          </span>
        )}
        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <button
            type="button"
            className={tabBtn(markdownEditSurface === 'wysiwyg')}
            onClick={() => setMarkdownEditSurface('wysiwyg')}
          >
            预览
          </button>
          <button
            type="button"
            className={tabBtn(markdownEditSurface === 'source')}
            onClick={() => setMarkdownEditSurface('source')}
          >
            源码
          </button>
          <button
            type="button"
            className={tabBtn(markdownEditSurface === 'split')}
            onClick={() => setMarkdownEditSurface('split')}
          >
            分栏
          </button>
          <button type="button" className={tabBtn(outlineOpen)} onClick={() => setOutlineOpen((o) => !o)}>
            大纲
          </button>
        </div>
      </div>

      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'row', overflow: 'hidden' }}>
        {/* 仅用 flex:1 + minHeight:0 参与剩余高度分配；勿写 height:0，嵌套 flex 下会把可用高度算成 0，预览/源码整块消失 */}
        <div style={{ flex: 1, minWidth: 0, minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          {markdownEditSurface === 'wysiwyg' ? (
            <div
              ref={zoomLayerRef}
              className="markdown-zoom-layer flux-scroll"
              style={{
                flex: 1,
                minHeight: 0,
                overflow: 'auto',
              }}
            >
              <div
                style={{
                  transform: `scale(${previewZoom})`,
                  transformOrigin: 'top left',
                  width: `${100 / previewZoom}%`,
                  boxSizing: 'border-box',
                }}
              >
                <MdPreview content={sourceContent} scrollable={false} />
              </div>
            </div>
          ) : markdownEditSurface === 'split' ? (
            <SplitView sourceContent={sourceContent} />
          ) : (
            <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
              <EditorPane hideFileBar />
            </div>
          )}
        </div>
        {outlineOpen && <MarkdownOutlineAside onPick={onOutlinePick} />}
      </div>
    </div>
  )
}
