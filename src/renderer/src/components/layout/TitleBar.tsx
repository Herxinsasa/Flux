import { MenuBar } from './MenuBar'
import { CircleHelp, Sun } from 'lucide-react'

interface TitleBarProps {
  onOpenSettings?: () => void
  onOpenSkills?: () => void
  onOpenHelp?: () => void
  onToggleTheme?: () => void
}

/**
 * 顶栏：主题化菜单 + 右侧拖拽区（系统窗口按钮由 OS 绘制，明暗由 nativeTheme 同步）
 */
export function TitleBar({ onOpenSettings, onOpenSkills, onOpenHelp, onToggleTheme }: TitleBarProps) {
  return (
    <div
      className="h-8 flex flex-row items-stretch shrink-0 border-b border-[var(--border-subtle)] bg-[var(--bg-primary)]"
    >
      <MenuBar onOpenSettings={onOpenSettings} onOpenSkills={onOpenSkills} onOpenHelp={onOpenHelp} />
      <div
        className="flex-1 min-w-0"
        style={{ WebkitAppRegion: 'drag' }}
        aria-hidden
      />
      <div className="flex items-center gap-1 pr-2" style={{ WebkitAppRegion: 'no-drag' }}>
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
