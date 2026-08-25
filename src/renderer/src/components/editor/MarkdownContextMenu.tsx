import { useEffect, useLayoutEffect, useRef, useState, type ComponentType } from 'react'
import {
  Bold,
  Braces,
  CheckSquare,
  ChevronRight,
  Code2,
  FileImage,
  Heading1,
  Italic,
  Link,
  List,
  ListOrdered,
  MessageSquareText,
  Minus,
  Quote,
  Table2,
  TextQuote,
} from 'lucide-react'
import {
  MARKDOWN_COMMAND_GROUPS,
  type MarkdownCommandId,
  type MarkdownCommandItem,
} from './markdownCommandModel'

interface MenuGroup {
  label: string
  icon: ComponentType<{ size?: number; strokeWidth?: number }>
  items: Array<MarkdownCommandItem & { icon: ComponentType<{ size?: number; strokeWidth?: number }> }>
}

const GROUP_ICONS = { 样式: Bold, 段落: Heading1, 插入: Braces } as const
const ITEM_ICONS: Record<Exclude<MarkdownCommandId, 'quote-ai' | 'comment'>, MenuGroup['icon']> = {
  bold: Bold,
  italic: Italic,
  'inline-code': Code2,
  blockquote: TextQuote,
  'ordered-list': ListOrdered,
  'unordered-list': List,
  'task-list': CheckSquare,
  'heading-1': Heading1,
  'heading-2': Heading1,
  'heading-3': Heading1,
  'heading-4': Heading1,
  'heading-5': Heading1,
  'insert-link': Link,
  'insert-image': FileImage,
  'insert-table': Table2,
  'insert-code-block': Code2,
  'insert-divider': Minus,
}
const GROUPS: MenuGroup[] = MARKDOWN_COMMAND_GROUPS.map((group) => ({
  ...group,
  icon: GROUP_ICONS[group.label],
  items: group.items.map((item) => ({ ...item, icon: ITEM_ICONS[item.id as keyof typeof ITEM_ICONS] })),
}))

export interface MarkdownContextMenuProps {
  x: number
  y: number
  hasSelection: boolean
  readOnly: boolean
  aiEnabled: boolean
  commentEnabled?: boolean
  onClose: () => void
  onCommand: (command: MarkdownCommandId) => void
}

export function clampMenuPosition(
  x: number,
  y: number,
  width: number,
  height: number,
  viewportWidth = window.innerWidth,
  viewportHeight = window.innerHeight,
) {
  return {
    x: Math.max(8, Math.min(x, viewportWidth - width - 8)),
    y: Math.max(8, Math.min(y, viewportHeight - height - 8)),
  }
}

export function getSubmenuOffsetY(
  rect: Pick<DOMRect, 'top' | 'bottom'>,
  viewportHeight = window.innerHeight,
): number {
  if (rect.bottom > viewportHeight - 8) return viewportHeight - 8 - rect.bottom
  if (rect.top < 8) return 8 - rect.top
  return 0
}

export function MarkdownContextMenu({
  x,
  y,
  hasSelection,
  readOnly,
  aiEnabled,
  commentEnabled = true,
  onClose,
  onCommand,
}: MarkdownContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null)
  const submenuRef = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState({ x, y })
  const [openGroup, setOpenGroup] = useState<string | null>(null)
  const [submenuOffsetY, setSubmenuOffsetY] = useState(0)
  const submenuLeft = position.x > window.innerWidth - 430

  useLayoutEffect(() => {
    const rect = menuRef.current?.getBoundingClientRect()
    if (!rect) return
    setPosition(clampMenuPosition(x, y, rect.width, rect.height))
  }, [x, y])

  useLayoutEffect(() => {
    if (!openGroup) {
      setSubmenuOffsetY(0)
      return
    }
    const rect = submenuRef.current?.getBoundingClientRect()
    if (rect) setSubmenuOffsetY(getSubmenuOffsetY(rect))
  }, [openGroup])

  useEffect(() => {
    const closeOnPointer = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) onClose()
    }
    const closeOnKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', closeOnPointer)
    document.addEventListener('keydown', closeOnKey)
    return () => {
      document.removeEventListener('mousedown', closeOnPointer)
      document.removeEventListener('keydown', closeOnKey)
    }
  }, [onClose])

  const run = (id: MarkdownCommandId, disabled: boolean) => {
    if (disabled) return
    onCommand(id)
    onClose()
  }

  const renderItem = (item: MenuGroup['items'][number]) => {
    const disabled = readOnly || (!!item.needsSelection && !hasSelection)
    const Icon = item.icon
    return (
      <button
        key={item.id}
        type="button"
        className="markdown-context-item"
        disabled={disabled}
        role="menuitem"
        onClick={() => run(item.id, disabled)}
      >
        <Icon size={16} strokeWidth={1.8} />
        <span>{item.label}</span>
      </button>
    )
  }

  return (
    <div
      ref={menuRef}
      className="markdown-context-menu"
      role="menu"
      style={{ left: position.x, top: position.y }}
      onContextMenu={(event) => event.preventDefault()}
    >
      <button
        type="button"
        className="markdown-context-item"
        disabled={!hasSelection || !aiEnabled}
        title={!aiEnabled ? '请先配置 AI 服务' : undefined}
        onClick={() => run('quote-ai', !hasSelection || !aiEnabled)}
      >
        <Quote size={16} strokeWidth={1.8} /><span>引用</span>
      </button>
      <button
        type="button"
        className="markdown-context-item"
        disabled={!hasSelection || !commentEnabled}
        onClick={() => run('comment', !hasSelection || !commentEnabled)}
      >
        <MessageSquareText size={16} strokeWidth={1.8} /><span>批注</span>
      </button>
      <div className="markdown-context-separator" />
      {GROUPS.map((group) => {
        const Icon = group.icon
        return (
          <div
            key={group.label}
            className="markdown-context-group"
            onMouseEnter={() => setOpenGroup(group.label)}
            onMouseLeave={() => setOpenGroup(null)}
          >
            <button type="button" className="markdown-context-item" aria-haspopup="menu" aria-expanded={openGroup === group.label}>
              <Icon size={16} strokeWidth={1.8} /><span>{group.label}</span><ChevronRight className="markdown-context-chevron" size={15} />
            </button>
            {openGroup === group.label && (
              <div
                ref={submenuRef}
                className={`markdown-context-submenu${submenuLeft ? ' markdown-context-submenu--left' : ''}`}
                role="menu"
                style={{ top: -5 + submenuOffsetY }}
              >
                {group.items.map(renderItem)}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
