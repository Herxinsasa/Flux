import { Zap, Settings } from 'lucide-react'
import { useSettingsStore } from '../../stores/settingsStore'
import { FileTree } from '../common/FileTree'

interface SidebarProps {
  onNavigateToSettings?: () => void
  onNavigateToSkills?: () => void
}

export function Sidebar({ onNavigateToSettings, onNavigateToSkills }: SidebarProps) {
  return (
    <aside className="bg-[var(--bg-panel)] flex flex-col shrink-0 w-full h-full min-h-0 min-w-0">
      {/* Header — matches Pencil: "Flux" title + icon buttons */}
      <div
        className="flex items-center justify-between shrink-0"
        style={{ padding: '16px 12px' }}
      >
        <div className="flex items-center gap-2 min-w-0">
          <span
            className="font-semibold select-none text-app-lg text-[var(--text-primary)] truncate"
            style={{ fontFamily: 'var(--font-ui)' }}
          >
            Flux
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          {onNavigateToSkills && (
            <button
              type="button"
              onClick={onNavigateToSkills}
              className="sidebar-toolbar-btn"
              title="Skill 管理"
            >
              <Zap size={14} strokeWidth={1.75} aria-hidden />
            </button>
          )}
          {onNavigateToSettings && (
            <button type="button" onClick={onNavigateToSettings} className="sidebar-toolbar-btn" title="设置">
              <Settings size={14} strokeWidth={1.75} aria-hidden />
            </button>
          )}
        </div>
      </div>

      <FileTree />
    </aside>
  )
}
