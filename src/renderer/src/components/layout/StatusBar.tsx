import { useChatStore } from '../../stores/chatStore'
import { useFileStore } from '../../stores/fileStore'
import { useEditorStore, EDITOR_MODE_LABEL } from '../../stores/editorStore'

function formatSize(bytes: number): string {
  if (bytes === 0) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

function formatNumber(n: number): string {
  return n.toLocaleString()
}

export function StatusBar() {
  useChatStore((s) => s.agentStatus)
  const files = useFileStore((s) => s.files)
  const currentFile = useFileStore((s) => s.currentFile)
  const mode = useEditorStore((s) => s.mode)

  const activeFile = files.find((f) => f.path === currentFile)

  return (
    <div className="h-8 bg-[var(--bg-panel)] border-t border-[var(--border-subtle)] flex items-center justify-between px-3 text-app-sm shrink-0 select-none">
      {/* Left: File info */}
      <div className="flex items-center gap-1 text-[var(--text-hint)] min-w-0">
        {activeFile ? (
          <>
            <span className="truncate">{activeFile.name}</span>
            <span>·</span>
            <span className="whitespace-nowrap">{formatNumber(activeFile.lines)} 行</span>
            <span>·</span>
            <span className="whitespace-nowrap">{formatSize(activeFile.size)}</span>
          </>
        ) : (
          <span>未打开文件</span>
        )}
      </div>

      {/* Right: Editor info */}
      <div className="flex items-center gap-2 text-[var(--text-hint)] flex-shrink-0">
        <span>{EDITOR_MODE_LABEL[mode]}</span>
      </div>
    </div>
  )
}
