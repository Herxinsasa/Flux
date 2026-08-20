import { useCallback, useEffect, useRef, useState } from 'react'
import { FilePlus2, FolderOpen, Trash2, X } from 'lucide-react'
import type { RecentItemData } from '../../../../shared/recent'
import { useFileImport } from '../../hooks/useFileImport'
import { useFileStore } from '../../stores/fileStore'

export function DropZone() {
  const { importFile, importFiles } = useFileImport()
  const openFolder = useFileStore((s) => s.openFolder)
  const [isDragOver, setIsDragOver] = useState(false)
  const [recentItems, setRecentItems] = useState<RecentItemData[]>([])
  const [onboardingCompleted, setOnboardingCompleted] = useState(true)
  const dragCounter = useRef(0)

  const loadRecentItems = useCallback(async () => {
    try {
      const result = await window.electronAPI.recent.list()
      if (result.success) setRecentItems(result.data ?? [])
    } catch {
      setRecentItems([])
    }
  }, [])

  useEffect(() => {
    void loadRecentItems()
    void window.electronAPI.settings.get().then((result) => {
      if (result.success && result.data) {
        setOnboardingCompleted(result.data.onboardingCompleted ?? false)
      }
    })
  }, [loadRecentItems])

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    ;(e.nativeEvent as { __fluxDropHandled?: boolean }).__fluxDropHandled = true
    dragCounter.current = 0
    setIsDragOver(false)
    const paths = Array.from(e.dataTransfer.files).flatMap((file) => {
      const filePath = window.electronAPI.file.getFilePath(file)
      return filePath ? [filePath] : []
    })
    if (paths.length > 0) await importFiles(paths)
  }, [importFiles])

  const openRecent = useCallback(async (item: RecentItemData) => {
    if (!item.exists) return
    if (item.kind === 'folder') {
      await openFolder(item.path)
      return
    }
    await useFileStore.getState().openFile(item.path)
  }, [openFolder])

  const removeRecent = useCallback(async (event: React.MouseEvent, itemPath: string) => {
    event.stopPropagation()
    await window.electronAPI.recent.remove(itemPath)
    await loadRecentItems()
  }, [loadRecentItems])

  const dismissOnboarding = useCallback(async () => {
    setOnboardingCompleted(true)
    await window.electronAPI.settings.save({ onboardingCompleted: true })
  }, [])

  return (
    <div
      className={`flex-1 min-h-0 overflow-auto p-8 ${isDragOver ? 'bg-[var(--accent)]/10' : ''}`}
      onDragOver={(e) => { e.preventDefault(); setIsDragOver(true) }}
      onDragLeave={() => setIsDragOver(false)}
      onDrop={handleDrop}
    >
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-8 py-10">
        <div className="flex items-center gap-2">
          <button type="button" onClick={importFile} className="flex items-center gap-2 rounded-[var(--radius-sm)] bg-[var(--accent)] px-3 py-2 text-sm text-white">
            <FilePlus2 size={16} aria-hidden /> 打开文件
          </button>
          <button type="button" onClick={() => void openFolder()} className="flex items-center gap-2 rounded-[var(--radius-sm)] border border-[var(--border-subtle)] px-3 py-2 text-sm">
            <FolderOpen size={16} aria-hidden /> 打开文件夹
          </button>
        </div>

        {recentItems.length > 0 ? <section aria-label="最近项目">
          <h2 className="mb-3 text-sm font-medium text-[var(--text-secondary)]">最近项目</h2>
          <div className="divide-y divide-[var(--border-subtle)] border-y border-[var(--border-subtle)]">
            {recentItems.map((item) => <div key={item.path} className={`flex w-full items-center gap-3 px-3 py-3 ${item.exists ? 'hover:bg-[var(--bg-hover)]' : 'opacity-50'}`}>
              <button type="button" disabled={!item.exists} onClick={() => void openRecent(item)} className="flex min-w-0 flex-1 items-center gap-3 text-left disabled:cursor-default">
                <FolderOpen size={16} aria-hidden />
                <span className="min-w-0 flex-1"><span className="block truncate text-sm">{item.path.split(/[/\\]/).pop()}</span><span className="block truncate text-xs text-[var(--text-hint)]">{item.path}</span></span>
                <span className="text-xs text-[var(--text-hint)]">{new Date(item.openedAt).toLocaleDateString()}</span>
              </button>
              {!item.exists && <button type="button" onClick={(event) => void removeRecent(event, item.path)} className="sidebar-toolbar-btn" title="移除失效项目" aria-label="移除失效项目"><Trash2 size={14} aria-hidden /></button>}
            </div>)}
          </div>
        </section> : <div className="border border-dashed border-[var(--border-subtle)] p-8 text-center text-sm text-[var(--text-hint)]"><p>将文本文件拖到这里开始</p></div>}
        {!onboardingCompleted && <section className="relative border border-[var(--border-subtle)] p-4 pr-10" aria-label="首次使用提示">
          <button type="button" onClick={() => void dismissOnboarding()} className="sidebar-toolbar-btn absolute right-2 top-2" title="关闭提示" aria-label="关闭提示"><X size={14} aria-hidden /></button>
          <ul className="space-y-2 text-xs text-[var(--text-secondary)]"><li>打开文本</li><li>开始编辑</li><li>按需使用 AI</li></ul>
        </section>}
      </div>
    </div>
  )
}
