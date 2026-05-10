import { useMemo } from 'react'
import { parseMarkdownOutline, type MdOutlineItem } from '../../utils/markdownHeadingIds'

interface MdOutlinePanelProps {
  content: string
  onPick: (item: MdOutlineItem) => void
}

export function MdOutlinePanel({ content, onPick }: MdOutlinePanelProps) {
  const items = useMemo(() => parseMarkdownOutline(content), [content])

  if (items.length === 0) {
    return (
      <div className="flex flex-col min-h-0 h-full flux-scroll flux-scroll--panel overflow-y-auto text-app-sm text-[var(--text-hint)] px-3 py-4">
        当前文档无标题
      </div>
    )
  }

  return (
    <div className="flex flex-col min-h-0 h-full w-full flux-scroll flux-scroll--panel overflow-y-auto overflow-x-hidden text-app-sm font-[var(--font-ui)]">
      <div className="shrink-0 px-2 py-2 text-[var(--text-tertiary)] text-app-xs uppercase tracking-wide">
        大纲
      </div>
      <ul className="pb-2 list-none m-0 p-0">
        {items.map((item) => (
          <li key={item.id}>
            <button
              type="button"
              className="w-full text-left truncate py-1 px-2 rounded-[var(--radius-sm)] text-[var(--text-secondary)] hover:bg-[var(--hover)] hover:text-[var(--text-primary)] cursor-pointer border-0 bg-transparent"
              style={{ paddingLeft: 8 + (item.level - 1) * 12 }}
              title={item.text}
              onClick={() => onPick(item)}
            >
              {item.text}
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
