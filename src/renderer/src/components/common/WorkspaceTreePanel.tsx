import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronRight } from 'lucide-react'
import type { WorkspaceFileEntry } from '../../../../shared/types'
import { buildWorkspaceTree, mergeWorkspaceTree, type WorkspaceFsNode } from '../../utils/workspaceTree'

const EMOJI_MAP: Record<string, string> = {
  '.json': '📋',
  '.jsonc': '📋',
  '.md': '📄',
  '.markdown': '📄',
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

interface WorkspaceTreePanelProps {
  workspaceRoot: string | null
  workspaceFiles: WorkspaceFileEntry[]
  scanVersion: number
  scanStatus: 'idle' | 'scanning' | 'complete' | 'cancelled' | 'error'
  scanError: string | null
  currentFile: string | null
  onOpenFile: (path: string) => void
}

function WorkspaceNodes({
  nodes,
  depth,
  expanded,
  toggleDir,
  currentFile,
  onOpenFile,
}: {
  nodes: WorkspaceFsNode[]
  depth: number
  expanded: Set<string>
  toggleDir: (pathKey: string) => void
  currentFile: string | null
  onOpenFile: (path: string) => void
}) {
  return (
    <div className="flex flex-col gap-[2px]">
      {nodes.map((node) => {
        if (node.kind === 'file') {
          const isActive = node.path === currentFile
          const emoji = fileEmoji(node.extension)
          return (
            <button
              key={node.path}
              type="button"
              onClick={() => void onOpenFile(node.path)}
              className={`w-full text-left rounded-[var(--radius-sm)] text-app-sm cursor-pointer transition-colors duration-[var(--transition-fast)] flex items-center gap-2 font-[var(--font-ui)] ${
                isActive
                  ? 'bg-[var(--selection)] text-[var(--text-primary)]'
                  : 'text-[var(--text-secondary)] hover:bg-[var(--hover)]'
              }`}
              style={{ padding: '8px 6px', paddingLeft: 6 + depth * 12 }}
              title={node.path}
            >
              <span className="shrink-0 text-app-sm leading-none" aria-hidden>
                {emoji}
              </span>
              <span className="truncate flex-1 min-w-0">{node.name}</span>
            </button>
          )
        }

        const isOpen = expanded.has(node.pathKey)
        return (
          <div key={node.pathKey} className="flex flex-col gap-[2px]">
            <button
              type="button"
              onClick={() => toggleDir(node.pathKey)}
              className="w-full text-left rounded-[var(--radius-sm)] text-app-sm cursor-pointer transition-colors duration-[var(--transition-fast)] flex items-center gap-1 font-[var(--font-ui)] text-[var(--text-secondary)] hover:bg-[var(--hover)] hover:text-[var(--text-primary)] border-0 bg-transparent"
              style={{ padding: '8px 6px', paddingLeft: 4 + depth * 12 }}
              title={node.pathKey}
            >
              <ChevronRight
                size={14}
                strokeWidth={2}
                className={`shrink-0 transition-transform duration-150 ${isOpen ? 'rotate-90' : ''}`}
                aria-hidden
              />
              <span className="shrink-0 text-app-sm leading-none" aria-hidden>
                📁
              </span>
              <span className="truncate flex-1 min-w-0">{node.name}</span>
            </button>
            {isOpen && (
              <WorkspaceNodes
                nodes={node.children}
                depth={depth + 1}
                expanded={expanded}
                toggleDir={toggleDir}
                currentFile={currentFile}
                onOpenFile={onOpenFile}
              />
            )}
          </div>
        )
      })}
    </div>
  )
}

export function WorkspaceTreePanel({
  workspaceRoot,
  workspaceFiles,
  scanVersion,
  scanStatus,
  scanError,
  currentFile,
  onOpenFile,
}: WorkspaceTreePanelProps) {
  const [tree, setTree] = useState<WorkspaceFsNode[]>([])
  const seenPaths = useRef(new Set<string>())
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())

  /** 切换工作区时清空展开状态；默认全部折叠，避免一次展开过多目录 */
  useEffect(() => {
    seenPaths.current = new Set(workspaceFiles.map((file) => file.path))
    setTree(workspaceRoot ? buildWorkspaceTree(workspaceFiles) : [])
    setExpanded((current) => workspaceRoot ? current : new Set())
  }, [workspaceRoot, scanVersion])

  useEffect(() => {
    if (!workspaceRoot) return
    const additions = workspaceFiles.filter((file) => !seenPaths.current.has(file.path))
    if (additions.length === 0) return
    additions.forEach((file) => seenPaths.current.add(file.path))
    setTree((current) => mergeWorkspaceTree(current, additions))
  }, [workspaceFiles, workspaceRoot])

  const toggleDir = useCallback((pathKey: string) => {
    setExpanded((prev) => {
      const n = new Set(prev)
      if (n.has(pathKey)) n.delete(pathKey)
      else n.add(pathKey)
      return n
    })
  }, [])

  if (!workspaceRoot) {
    return <p className="text-app-xs text-[var(--text-hint)] px-1">未打开文件夹</p>
  }

  if (scanStatus === 'error') {
    return <p className="text-app-xs text-[var(--text-hint)] px-1">{scanError ?? '工作区扫描失败'}</p>
  }

  if (tree.length === 0) {
    return <p className="text-app-xs text-[var(--text-hint)] px-1">{scanStatus === 'scanning' ? '正在扫描文件夹…' : '该文件夹下没有可显示的文件'}</p>
  }

  return (
    <>
      <WorkspaceNodes
        nodes={tree}
        depth={0}
        expanded={expanded}
        toggleDir={toggleDir}
        currentFile={currentFile}
        onOpenFile={onOpenFile}
      />
      {scanStatus === 'scanning' && <p className="text-app-xs text-[var(--text-hint)] px-1 pt-1">正在扫描…</p>}
    </>
  )
}
