import { useCallback, useEffect, useState, memo } from 'react'
import { RotateCcw, ZoomIn, ZoomOut } from 'lucide-react'
import { useEditorStore } from '../../stores/editorStore'
import { useFileStore } from '../../stores/fileStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { applyMarkdownZoomAction, getMarkdownZoomPercent } from '../../hooks/useShortcuts'
import { EditorPane } from './EditorPane'
import { MdWysiwygEditor } from './MdWysiwygEditor'
import { MdOutlinePanel } from './MdOutlinePanel'
import type { MdOutlineItem } from '../../utils/markdownHeadingIds'

const StableEditorPane = memo(EditorPane)

/** 仅在大纲打开时挂载；输入期间合并全文更新，避免每个按键都重新解析长文档。 */
const MarkdownOutlineAside = memo(function MarkdownOutlineAside({
  onPick,
}: {
  onPick: (item: MdOutlineItem) => void
}) {
  const [outlineMarkdown, setOutlineMarkdown] = useState(() => useEditorStore.getState().content)
  useEffect(() => {
    let timer: number | null = null
    const unsubscribe = useEditorStore.subscribe((state, previousState) => {
      if (state.content === previousState.content) return
      if (timer != null) window.clearTimeout(timer)
      timer = window.setTimeout(() => setOutlineMarkdown(useEditorStore.getState().content), 250)
    })
    return () => {
      unsubscribe()
      if (timer != null) window.clearTimeout(timer)
    }
  }, [])
  return (
    <div
      className="flex flex-col min-h-0 shrink-0 overflow-hidden"
      style={{
        width: 220,
        borderRight: '1px solid var(--border-subtle)',
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
  const setContent = useEditorStore((s) => s.setContent)
  const requestJumpToOutlineLine = useEditorStore((s) => s.requestJumpToOutlineLine)
  const theme = useSettingsStore((s) => s.theme)
  const readingPreferences = useSettingsStore((s) => s.readingPreferences)

  const currentFile = useFileStore((s) => s.currentFile)
  const currentFileName = useFileStore((s) => {
    const f = s.files.find((x) => x.path === s.currentFile)
    return f?.name ?? null
  })

  const [outlineOpen, setOutlineOpen] = useState(false)
  const [wysiwygOutlineTarget, setWysiwygOutlineTarget] = useState<{
    level: number
    text: string
    occurrence: number
    requestId: number
  } | null>(null)
  const zoomPercent = getMarkdownZoomPercent()

  useEffect(() => {
    setOutlineOpen(false)
    // 文件切换时清除大纲跳转目标，避免残留目标在新编辑器就绪后误跳
    setWysiwygOutlineTarget(null)
  }, [currentFile])

  const onOutlinePick = useCallback(
    (item: MdOutlineItem) => {
      if (markdownEditSurface === 'wysiwyg') {
        setWysiwygOutlineTarget({
          level: item.level,
          text: item.text,
          occurrence: item.occurrence,
          requestId: Date.now(),
        })
      } else {
        requestJumpToOutlineLine(item.line)
      }
    },
    [markdownEditSurface, requestJumpToOutlineLine],
  )

  const tabBtn = (active: boolean) =>
    `px-2 py-1 rounded-[var(--radius-sm)] text-app-sm border-0 cursor-pointer font-[var(--font-ui)] ${
      active
        ? 'bg-[var(--selection)] text-[var(--text-primary)]'
        : 'text-[var(--text-secondary)] hover:bg-[var(--hover)] bg-transparent'
    }`

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
              fontSize: 13,
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
            编辑
          </button>
          <button
            type="button"
            className={tabBtn(markdownEditSurface === 'source')}
            onClick={() => setMarkdownEditSurface('source')}
          >
            源码
          </button>
          <button type="button" className={tabBtn(outlineOpen)} onClick={() => setOutlineOpen((o) => !o)}>
            大纲
          </button>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 2, marginLeft: 'auto' }}>
          <button
            type="button"
            className={tabBtn(false)}
            onClick={() => applyMarkdownZoomAction('out')}
            title="缩小内容 (Ctrl+-)"
            aria-label="缩小内容"
          >
            <ZoomOut size={16} aria-hidden="true" />
          </button>
          <span
            style={{
              width: 48,
              textAlign: 'center',
              color: 'var(--text-secondary)',
              fontFamily: 'var(--font-mono)',
              fontSize: 13,
              fontVariantNumeric: 'tabular-nums',
            }}
            aria-label={`当前内容缩放 ${zoomPercent}%`}
          >
            {zoomPercent}%
          </span>
          <button
            type="button"
            className={tabBtn(false)}
            onClick={() => applyMarkdownZoomAction('in')}
            title="放大内容 (Ctrl+=)"
            aria-label="放大内容"
          >
            <ZoomIn size={16} aria-hidden="true" />
          </button>
          <button
            type="button"
            className={tabBtn(false)}
            onClick={() => applyMarkdownZoomAction('reset')}
            title="复位内容缩放 (Ctrl+0)"
            aria-label="复位内容缩放"
          >
            <RotateCcw size={16} aria-hidden="true" />
          </button>
        </div>
      </div>

      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'row', overflow: 'hidden' }}>
        {outlineOpen && <MarkdownOutlineAside onPick={onOutlinePick} />}
        {/* 仅用 flex:1 + minHeight:0 参与剩余高度分配；勿写 height:0，嵌套 flex 下会把可用高度算成 0，预览/源码整块消失 */}
        <div style={{ flex: 1, minWidth: 0, minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          {markdownEditSurface === 'wysiwyg' ? (
            <div
              className="flux-scroll"
              style={{
                flex: 1,
                minHeight: 0,
                overflow: 'auto',
                fontSize: `${readingPreferences.bodyFontSize}px`,
              }}
            >
              <MdWysiwygEditor
                fileKey={currentFile ?? 'untitled'}
                onMarkdownCommit={setContent}
                theme={theme}
                outlineTarget={wysiwygOutlineTarget}
              />
            </div>
          ) : (
            <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
              <StableEditorPane hideFileBar />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
