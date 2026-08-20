import { MenuBar } from './MenuBar'
import { Bot, CircleHelp, MessageSquareText, PanelLeft, Sun } from 'lucide-react'

interface TitleBarProps {
  onOpenSettings?: () => void
  onOpenSkills?: () => void
  onOpenHelp?: () => void
  onOpenAbout?: () => void
  onToggleTheme?: () => void
  onToggleChat?: () => void
  chatVisible?: boolean
  onToggleReview?: () => void
  reviewVisible?: boolean
  reviewCount?: number
  onToggleWorkspace?: () => void
  workspaceVisible?: boolean
}

/**
 * 顶栏：主题化菜单 + 右侧拖拽区（系统窗口按钮由 OS 绘制，明暗由 nativeTheme 同步）
 */
export function TitleBar({ onOpenSettings, onOpenSkills, onOpenHelp, onOpenAbout, onToggleTheme, onToggleChat, chatVisible, onToggleReview, reviewVisible, reviewCount = 0, onToggleWorkspace, workspaceVisible }: TitleBarProps) {
  return (
    <div
      className="h-8 flex flex-row items-stretch shrink-0 border-b border-[var(--border-subtle)] bg-[var(--bg-primary)]"
    >
      <MenuBar onOpenSettings={onOpenSettings} onOpenSkills={onOpenSkills} onOpenHelp={onOpenHelp} onOpenAbout={onOpenAbout} />
      <div
        className="flex-1 min-w-0"
        style={{ WebkitAppRegion: 'drag' }}
        aria-hidden
      />
      <div className="flex items-center gap-1 pr-2" style={{ WebkitAppRegion: 'no-drag' }}>
        <button type="button" className="sidebar-toolbar-btn" title={workspaceVisible ? '隐藏工作区' : '显示工作区'} onClick={onToggleWorkspace} aria-pressed={workspaceVisible}>
          <PanelLeft size={14} strokeWidth={1.75} aria-hidden />
        </button>
        <button type="button" className="sidebar-toolbar-btn sidebar-toolbar-btn--with-badge" title={reviewCount > 0 ? `${reviewVisible ? '关闭' : '打开'}批注，${reviewCount} 条未解决` : reviewVisible ? '关闭批注' : '打开批注'} onClick={onToggleReview} aria-pressed={reviewVisible}>
          <MessageSquareText size={14} strokeWidth={1.75} aria-hidden />
          {reviewCount > 0 && <span className="sidebar-toolbar-badge">{reviewCount > 99 ? '99+' : reviewCount}</span>}
        </button>
        <button type="button" className="sidebar-toolbar-btn" title={chatVisible ? 'Hide AI panel' : 'Show AI panel'} onClick={onToggleChat} aria-pressed={chatVisible}>
          <Bot size={14} strokeWidth={1.75} aria-hidden />
        </button>
        <button type="button" className="sidebar-toolbar-btn" title="主题切换" onClick={onToggleTheme}>
          <Sun size={14} strokeWidth={1.75} aria-hidden />
        </button>
        <button type="button" className="sidebar-toolbar-btn" title="帮助" onClick={onOpenHelp}>
          <CircleHelp size={14} strokeWidth={1.75} aria-hidden />
        </button>
      </div>
    </div>
  )
}
