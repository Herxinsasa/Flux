import { useCallback, useMemo, useRef, useState } from 'react'
import { useFileStore, type FileEntry } from '../../stores/fileStore'
import { useFileImport } from '../../hooks/useFileImport'
import { WorkspaceTreePanel } from './WorkspaceTreePanel'

/** Pencil file row icons — prototypes.pen (e.g. 📄 app.log, 📋 debug.json) */
const EMOJI_MAP: Record<string, string> = {
  '.json': '📋',
  '.jsonc': '📋',
  '.md': '📄',
  '.log': '📄',
  '.txt': '📄',
  '.csv': '📊',
  '.xml': '📄',
  '.yaml': '📋',
  '.yml': '📋',
}

function fileEmoji(ext: string): string {
  return EMOJI_MAP[ext] || '📄'
}

function formatSize(bytes: number): string {
  if (bytes === 0) return ''
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
}

function normalizePathForCompare(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
}

function isPathInsideWorkspace(filePath: string, workspaceRoot: string | null): boolean {
  if (!workspaceRoot) return false
  const root = normalizePathForCompare(workspaceRoot)
  const file = normalizePathForCompare(filePath)
  return file === root || file.startsWith(`${root}/`)
}

/* ── FileTreeItem ── */

function FileTreeItem({ file, badge }: { file: FileEntry; badge?: string }) {
  const currentFile = useFileStore((s) => s.currentFile)
  const setCurrentFile = useFileStore((s) => s.setCurrentFile)
  const removeFile = useFileStore((s) => s.removeFile)
  const isActive = file.path === currentFile
  const emoji = fileEmoji(file.extension)

  const handleClick = useCallback(() => {
    setCurrentFile(file.path)
  }, [file.path, setCurrentFile])

  const handleClose = useCallback(
    (e: React.MouseEvent<HTMLButtonElement>) => {
      e.preventDefault()
      e.stopPropagation()
      removeFile(file.path)
    },
    [file.path, removeFile],
  )

  return (
    <div
      className={`w-full text-left rounded-[var(--radius-sm)] text-app-sm cursor-pointer transition-colors duration-[var(--transition-fast)] flex items-center gap-2 font-[var(--font-mono)] ${
        isActive
          ? 'bg-[var(--selection)] text-[var(--text-primary)]'
          : 'text-[var(--text-secondary)] hover:bg-[var(--hover)]'
      }`}
      style={{ padding: '8px 6px' }}
      title={file.path}
    >
      <button
        type="button"
        onClick={handleClick}
        className="flex items-center gap-2 flex-1 min-w-0 text-left bg-transparent border-0 p-0 m-0 cursor-pointer text-inherit font-inherit"
      >
        <span
          className="shrink-0 text-app-sm font-[var(--font-mono)] font-normal leading-none"
          aria-hidden
        >
          {emoji}
        </span>
        <span className="truncate flex-1 min-w-0">{file.name}</span>
        {badge ? (
          <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded bg-[var(--hover)] text-[var(--text-tertiary)]">
            {badge}
          </span>
        ) : null}
        {file.size > 0 && (
          <span className="badge shrink-0">{formatSize(file.size)}</span>
        )}
      </button>
      <button
        type="button"
        onClick={handleClose}
        className="shrink-0 w-5 h-5 rounded text-[var(--text-hint)] hover:text-[var(--text-primary)] hover:bg-[var(--hover)] border-0 bg-transparent cursor-pointer leading-none"
        title={`关闭 ${file.name}`}
        aria-label={`关闭 ${file.name}`}
      >
        ×
      </button>
    </div>
  )
}

/* ── FileTree ── */

export function FileTree() {
  const files = useFileStore((s) => s.files)
  const workspaceRoot = useFileStore((s) => s.workspaceRoot)
  const workspaceFiles = useFileStore((s) => s.workspaceFiles)
  const openFolder = useFileStore((s) => s.openFolder)
  const clearWorkspace = useFileStore((s) => s.clearWorkspace)
  const openWorkspaceFile = useFileStore((s) => s.openWorkspaceFile)
  const currentFile = useFileStore((s) => s.currentFile)
  const { importFile, importFiles } = useFileImport()
  const dropRef = useRef<HTMLDivElement>(null)
  const dragCounter = useRef(0)
  const [isDragOver, setIsDragOver] = useState(false)

  const hasWorkspace = Boolean(workspaceRoot)

  const worksetFiles = useMemo(() => {
    if (!hasWorkspace) return files
    return files.filter((f) => f.path === currentFile || !isPathInsideWorkspace(f.path, workspaceRoot))
  }, [currentFile, files, hasWorkspace, workspaceRoot])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    e.dataTransfer.dropEffect = 'copy'
    setIsDragOver(true)
  }, [])

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dragCounter.current++
    setIsDragOver(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dragCounter.current--
    if (dragCounter.current <= 0) {
      dragCounter.current = 0
      setIsDragOver(false)
    }
  }, [])

  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      ;(e.nativeEvent as unknown as { __fluxDropHandled?: boolean }).__fluxDropHandled = true
      dragCounter.current = 0
      setIsDragOver(false)

      const droppedFiles = e.dataTransfer.files
      if (droppedFiles.length === 0) return

      const paths: string[] = []
      for (let i = 0; i < droppedFiles.length; i++) {
        try {
          const path = window.electronAPI.file.getFilePath(droppedFiles[i])
          if (path) paths.push(path)
        } catch {
          // skip
        }
      }

      if (paths.length > 0) {
        await importFiles(paths)
      }
    },
    [importFiles],
  )

  return (
    <div
      ref={dropRef}
      className={`flex-1 flex flex-col overflow-hidden min-h-0 transition-colors duration-[var(--transition-fast)] ${
        isDragOver ? 'bg-[var(--accent)]/10' : ''
      }`}
      onDragOver={handleDragOver}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* 有工作区时：工作区树为主，工作集为轻量辅助。无工作区时：工作集为主。 */}
      <div className="flex-1 flex flex-col min-h-0 gap-0 overflow-hidden px-2 pt-2">
        <section className="flex-1 flex flex-col min-h-0 overflow-hidden">
          <div className="shrink-0 flex items-center justify-between gap-2 pb-1 px-1">
            <span className="text-app-xs text-[var(--text-tertiary)] uppercase tracking-wide">
              {hasWorkspace ? '工作区' : '文件'}
            </span>
            <div className="flex gap-1 shrink-0">
              <button
                type="button"
                className="text-app-xs px-1.5 py-0.5 rounded border-0 bg-[var(--hover)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer"
                onClick={() => void openFolder()}
              >
                打开文件夹
              </button>
              {workspaceRoot && (
                <button
                  type="button"
                  className="text-app-xs px-1.5 py-0.5 rounded border-0 bg-transparent text-[var(--text-hint)] hover:text-[var(--text-secondary)] cursor-pointer"
                  onClick={() => clearWorkspace()}
                >
                  关闭
                </button>
              )}
            </div>
          </div>
          {workspaceRoot && (
            <p
              className="shrink-0 text-app-xs text-[var(--text-hint)] font-[var(--font-mono)] px-1 mb-1 truncate"
              title={workspaceRoot}
            >
              {workspaceRoot}
            </p>
          )}
          {hasWorkspace ? (
            <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden flux-scroll flux-scroll--panel pr-0.5">
              <WorkspaceTreePanel
                workspaceRoot={workspaceRoot}
                workspaceFiles={workspaceFiles}
                currentFile={currentFile}
                onOpenFile={(p) => void openWorkspaceFile(p)}
              />
            </div>
          ) : (
            <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden flux-scroll flux-scroll--panel pr-0.5">
              {worksetFiles.length === 0 ? (
                <div className="px-2 py-4 text-center rounded-[var(--radius-sm)] bg-[var(--bg-card)]/50">
                  <p className="text-app-sm text-[var(--text-hint)]">暂无已打开文件</p>
                  <p className="text-app-xs text-[var(--text-hint)] mt-1">打开文件、文件夹或拖入</p>
                </div>
              ) : (
                <div className="flex flex-col gap-[2px]">
                  {worksetFiles.map((f) => (
                    <FileTreeItem key={f.path} file={f} />
                  ))}
                </div>
              )}
            </div>
          )}
        </section>

        {hasWorkspace && (
          <>
            <div className="shrink-0 h-px my-2 mx-1 bg-[var(--border-subtle)]" aria-hidden />

            <section className="shrink-0 flex flex-col overflow-hidden max-h-[42%] min-h-[96px]">
              <div className="shrink-0 px-1 pb-1 text-app-xs text-[var(--text-tertiary)] uppercase tracking-wide">
                工作集 {worksetFiles.length > 0 ? `(${worksetFiles.length})` : ''}
              </div>
              <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden flux-scroll flux-scroll--panel pr-0.5">
                {worksetFiles.length === 0 ? (
                  <div className="px-2 py-2 text-app-xs text-[var(--text-hint)] rounded-[var(--radius-sm)] bg-[var(--bg-card)]/50">
                    当前打开文件都在工作区树中
                  </div>
                ) : (
                  <div className="flex flex-col gap-[2px]">
                    {worksetFiles.map((f) => {
                      const isExternal = !isPathInsideWorkspace(f.path, workspaceRoot)
                      return <FileTreeItem key={f.path} file={f} badge={isExternal ? '外部' : undefined} />
                    })}
                  </div>
                )}
              </div>
            </section>
          </>
        )}
      </div>

      <div className="p-3 shrink-0">
        <button
          type="button"
          onClick={importFile}
          title="也可使用菜单「文件 → 打开文件夹」加载整个目录"
          className="w-full h-16 flex flex-col items-center justify-center gap-1 rounded-[var(--radius-md)] bg-[var(--bg-card)] text-app-sm text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] transition-colors cursor-pointer border border-dashed border-[var(--border-subtle)]"
        >
          拖拽或打开文件
        </button>
      </div>
    </div>
  )
}
