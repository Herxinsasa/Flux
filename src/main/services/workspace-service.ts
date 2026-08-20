import fs from 'fs'
import path from 'path'
import type { TaskStartData, WorkspaceScanEvent } from '../../shared/types'

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

const MAX_FILES = 4000
const BATCH_SIZE = 200

interface WorkspaceScanTask {
  cancelled: boolean
}

const workspaceScanTasks = new Map<string, WorkspaceScanTask>()

function nextTaskId() {
  return `workspace-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
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

export interface WorkspaceFileEntry {
  path: string
  relativePath: string
}

/**
 * 递归列出工作区内可编辑文件（跳过常见依赖目录），按相对路径排序。
 */
export function listWorkspaceFiles(rootDir: string): WorkspaceFileEntry[] {
  const normRoot = path.resolve(rootDir)
  if (!fs.existsSync(normRoot) || !fs.statSync(normRoot).isDirectory()) {
    return []
  }

  const out: WorkspaceFileEntry[] = []

  function walk(dir: string) {
    if (out.length >= MAX_FILES) return
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const ent of entries) {
      if (out.length >= MAX_FILES) break
      const full = path.join(dir, ent.name)
      if (ent.isDirectory()) {
        if (shouldIgnoreDirectory(ent.name)) continue
        walk(full)
      } else if (ent.isFile() && !ent.name.endsWith('.review.json') && isAllowedFile(full)) {
        const rel = path.relative(normRoot, full).split(path.sep).join('/')
        out.push({ path: full, relativePath: rel })
      }
    }
  }

  walk(normRoot)
  out.sort((a, b) => a.relativePath.localeCompare(b.relativePath, undefined, { sensitivity: 'base' }))
  return out
}

/**
 * Scan a workspace in short event-loop slices. Consumers receive at most 200 files at a time.
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
      let fileCount = 0

      while (pendingDirs.length > 0 && fileCount < MAX_FILES) {
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
            if (!shouldIgnoreDirectory(entry.name)) pendingDirs.push(full)
            continue
          }
          if (!entry.isFile() || entry.name.endsWith('.review.json') || !isAllowedFile(full)) continue

          batch.push({ path: full, relativePath: path.relative(root, full).split(path.sep).join('/') })
          fileCount++
          if (batch.length === BATCH_SIZE) {
            emit({ status: 'batch', entries: batch.splice(0, batch.length) })
            await yieldToEventLoop()
          }
          if (fileCount >= MAX_FILES) break
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
