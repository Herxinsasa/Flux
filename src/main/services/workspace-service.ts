import fs from 'fs'
import path from 'path'
import type { TaskStartData, WorkspaceFileEntry, WorkspaceScanEvent } from '../../shared/types'

const IGNORE_DIR_NAMES = new Set([
  'node_modules',
  '.git',
  'dist',
  'out',
  'build',
  '.next',
  '__pycache__',
  '.venv',
  'venv',
  '.idea',
  '.vscode',
  'coverage',
])

/** 与打开文件对话框大致一致的可浏览扩展名 */
const ALLOWED_EXT = new Set([
  '.md',
  '.markdown',
  '.json',
  '.jsonc',
  '.txt',
  '.log',
  '.csv',
  '.xml',
  '.yaml',
  '.yml',
  '.js',
  '.mjs',
  '.cjs',
  '.ts',
  '.tsx',
  '.jsx',
  '.py',
  '.html',
  '.htm',
  '.css',
  '.scss',
  '.less',
  '.sh',
  '.bat',
  '.ps1',
  '.env',
  '.ini',
  '.cfg',
  '.conf',
  '.sql',
  '.rs',
  '.go',
  '.java',
  '.kt',
  '.c',
  '.h',
  '.cpp',
  '.hpp',
  '.cs',
  '.php',
  '.rb',
  '.swift',
])

const MAX_WORKSPACE_ENTRIES = 4000
const BATCH_SIZE = 200

interface WorkspaceScanTask {
  cancelled: boolean
}

interface WorkspaceWatchTask {
  watcher: fs.FSWatcher
  timer: NodeJS.Timeout | null
}

const workspaceScanTasks = new Map<string, WorkspaceScanTask>()
const workspaceWatchTasks = new Map<string, WorkspaceWatchTask>()

function nextTaskId() {
  return `workspace-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function nextWatchId() {
  return `workspace-watch-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve))
}

function shouldIgnoreDirectory(name: string): boolean {
  return name.startsWith('.') || IGNORE_DIR_NAMES.has(name)
}

function isAllowedFile(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase()
  if (ext) return ALLOWED_EXT.has(ext)
  const base = path.basename(filePath).toLowerCase()
  return base === 'dockerfile' || base === 'makefile' || base === 'gemfile'
}

/**
 * 递归列出工作区内可编辑文件和目录（跳过常见依赖目录），按相对路径排序。
 */
export function listWorkspaceFiles(rootDir: string): WorkspaceFileEntry[] {
  const normRoot = path.resolve(rootDir)
  if (!fs.existsSync(normRoot) || !fs.statSync(normRoot).isDirectory()) {
    return []
  }

  const out: WorkspaceFileEntry[] = []

  function walk(dir: string) {
    if (out.length >= MAX_WORKSPACE_ENTRIES) return
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const ent of entries) {
      if (out.length >= MAX_WORKSPACE_ENTRIES) break
      const full = path.join(dir, ent.name)
      if (ent.isDirectory()) {
        if (shouldIgnoreDirectory(ent.name)) continue
        const rel = path.relative(normRoot, full).split(path.sep).join('/')
        out.push({ path: full, relativePath: rel, kind: 'directory' })
        walk(full)
      } else if (ent.isFile() && !ent.name.endsWith('.review.json') && isAllowedFile(full)) {
        const rel = path.relative(normRoot, full).split(path.sep).join('/')
        out.push({ path: full, relativePath: rel, kind: 'file' })
      }
    }
  }

  walk(normRoot)
  out.sort((a, b) => a.relativePath.localeCompare(b.relativePath, undefined, { sensitivity: 'base' }))
  return out
}

/**
 * Scan a workspace in short event-loop slices. Consumers receive at most 200 entries at a time.
 */
export function startWorkspaceScan(
  rootDir: string,
  onEvent: (event: WorkspaceScanEvent) => void,
): TaskStartData {
  const taskId = nextTaskId()
  const task: WorkspaceScanTask = { cancelled: false }
  workspaceScanTasks.set(taskId, task)
  const root = path.resolve(rootDir)

  void (async () => {
    const emit = (event: Omit<WorkspaceScanEvent, 'taskId'>) => onEvent({ taskId, ...event })
    try {
      const rootStat = await fs.promises.stat(root)
      if (!rootStat.isDirectory()) throw new Error('Invalid workspace root')

      const pendingDirs = [root]
      const batch: WorkspaceFileEntry[] = []
      let entryCount = 0

      while (pendingDirs.length > 0 && entryCount < MAX_WORKSPACE_ENTRIES) {
        if (task.cancelled) {
          emit({ status: 'cancelled' })
          return
        }

        const dir = pendingDirs.shift()!
        let entries: fs.Dirent[]
        try {
          entries = await fs.promises.readdir(dir, { withFileTypes: true })
        } catch {
          await yieldToEventLoop()
          continue
        }

        entries.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
        for (const entry of entries) {
          if (task.cancelled) {
            emit({ status: 'cancelled' })
            return
          }
          const full = path.join(dir, entry.name)
          if (entry.isDirectory()) {
            if (!shouldIgnoreDirectory(entry.name)) {
              batch.push({
                path: full,
                relativePath: path.relative(root, full).split(path.sep).join('/'),
                kind: 'directory',
              })
              entryCount++
              pendingDirs.push(full)
            }
            if (batch.length === BATCH_SIZE) {
              emit({ status: 'batch', entries: batch.splice(0, batch.length) })
              await yieldToEventLoop()
            }
            if (entryCount >= MAX_WORKSPACE_ENTRIES) break
            continue
          }
          if (!entry.isFile() || entry.name.endsWith('.review.json') || !isAllowedFile(full)) continue

          batch.push({
            path: full,
            relativePath: path.relative(root, full).split(path.sep).join('/'),
            kind: 'file',
          })
          entryCount++
          if (batch.length === BATCH_SIZE) {
            emit({ status: 'batch', entries: batch.splice(0, batch.length) })
            await yieldToEventLoop()
          }
          if (entryCount >= MAX_WORKSPACE_ENTRIES) break
        }
        await yieldToEventLoop()
      }

      if (task.cancelled) {
        emit({ status: 'cancelled' })
        return
      }
      if (batch.length > 0) emit({ status: 'batch', entries: batch })
      emit({ status: 'complete' })
    } catch (error) {
      emit({ status: 'error', error: error instanceof Error ? error.message : String(error) })
    } finally {
      workspaceScanTasks.delete(taskId)
    }
  })()

  return { taskId }
}

export function cancelWorkspaceScan(taskId: string): boolean {
  const task = workspaceScanTasks.get(taskId)
  if (!task) return false
  task.cancelled = true
  return true
}

/**
 * Watch a Windows workspace recursively and collapse bursty filesystem events
 * into one refresh notification. The watcher never writes inside the workspace.
 */
export function startWorkspaceWatch(rootDir: string, onChange: (watchId: string, root: string) => void): TaskStartData {
  const root = path.resolve(rootDir)
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
    throw new Error('Invalid workspace root')
  }

  const watchId = nextWatchId()
  const task: WorkspaceWatchTask = { watcher: null as unknown as fs.FSWatcher, timer: null }
  const watcher = fs.watch(root, { recursive: true }, (_eventType, fileName) => {
    const relativePath = fileName?.toString().split(path.sep).join('/') ?? ''
    if (relativePath.split('/').some((part) => shouldIgnoreDirectory(part))) return
    if (relativePath.endsWith('.review.json')) return
    if (task.timer) clearTimeout(task.timer)
    task.timer = setTimeout(() => {
      task.timer = null
      onChange(watchId, root)
    }, 180)
  })
  task.watcher = watcher
  workspaceWatchTasks.set(watchId, task)
  watcher.on('error', () => stopWorkspaceWatch(watchId))
  return { taskId: watchId }
}

export function stopWorkspaceWatch(watchId: string): boolean {
  const task = workspaceWatchTasks.get(watchId)
  if (!task) return false
  if (task.timer) clearTimeout(task.timer)
  task.watcher.close()
  workspaceWatchTasks.delete(watchId)
  return true
}
