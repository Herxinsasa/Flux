import { useMemo, useState } from 'react'
import { MdPreview } from '../editor/MdPreview'
import helpContent from '../../help/help-content.md?raw'
import { parseMarkdownOutline, type MdOutlineItem } from '../../utils/markdownHeadingIds'

interface HelpViewProps {
  onBack: () => void
}

export function HelpView({ onBack }: HelpViewProps) {
  const [scrollTarget, setScrollTarget] = useState<{ id: string | null; key: number }>({
    id: null,
    key: 0,
  })

  const outline = useMemo<MdOutlineItem[]>(() => {
    return parseMarkdownOutline(helpContent).filter((x) => x.level <= 3)
  }, [])

  return (
    <div className="flex flex-col h-full bg-[var(--bg-primary)]">
      <div
        className="flex items-center gap-3 shrink-0 border-b border-[var(--border-visible)]"
        style={{ padding: '20px 24px' }}
      >
        <button
          onClick={onBack}
          className="flex items-center gap-1 rounded-[var(--radius-sm)] bg-[var(--bg-card)] text-[var(--text-secondary)] border border-[var(--border-subtle)] hover:text-[var(--text-primary)] hover:bg-[var(--hover)] hover:border-[var(--border-visible)] transition-colors"
          style={{ padding: '6px 10px', fontSize: 13, fontFamily: 'var(--font-ui)', cursor: 'pointer' }}
        >
          ← 返回
        </button>
        <h1
          style={{
            fontSize: 17,
            fontWeight: 600,
            fontFamily: 'var(--font-ui)',
            color: 'var(--text-primary)',
            margin: 0,
            flex: 1,
            minWidth: 0,
          }}
        >
          帮助中心
        </h1>
      </div>

      <div className="flex-1 min-h-0 flex overflow-hidden">
        <aside
          className="shrink-0 border-r border-[var(--border-visible)] flux-scroll"
          style={{ width: 280, padding: 12, overflowY: 'auto', background: 'var(--bg-panel)' }}
        >
          <div
            style={{
              fontSize: 12,
              color: 'var(--text-hint)',
              fontFamily: 'var(--font-ui)',
              marginBottom: 10,
              letterSpacing: '0.02em',
            }}
          >
            文档目录
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {outline.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setScrollTarget((prev) => ({ id: item.id, key: prev.key + 1 }))}
                className="text-left"
                style={{
                  border: 'none',
                  background: 'transparent',
                  color: 'var(--text-secondary)',
                  fontSize: item.level === 1 ? 13 : 12,
                  fontWeight: item.level === 1 ? 600 : 400,
                  cursor: 'pointer',
                  borderRadius: 6,
                  padding: item.level === 1 ? '6px 8px' : '5px 8px',
                  marginLeft: item.level === 1 ? 0 : item.level === 2 ? 8 : 16,
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'var(--hover)'
                  e.currentTarget.style.color = 'var(--text-primary)'
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'transparent'
                  e.currentTarget.style.color = 'var(--text-secondary)'
                }}
              >
                {item.text}
              </button>
            ))}
          </div>
        </aside>

        <section className="flex-1 min-w-0 min-h-0" style={{ background: 'var(--bg-viewer)' }}>
          <MdPreview
            content={helpContent}
            scrollToHeadingId={scrollTarget.id}
            scrollRequestKey={scrollTarget.key}
            scrollable
          />
        </section>
      </div>
    </div>
  )
}
