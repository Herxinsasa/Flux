import fs from 'fs'
import path from 'path'

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
        if (ent.name.startsWith('.') && ent.name !== '.github') continue
        if (IGNORE_DIR_NAMES.has(ent.name)) continue
        walk(full)
      } else if (ent.isFile() && isAllowedFile(full)) {
        const rel = path.relative(normRoot, full).split(path.sep).join('/')
        out.push({ path: full, relativePath: rel })
      }
    }
  }

  walk(normRoot)
  out.sort((a, b) => a.relativePath.localeCompare(b.relativePath, undefined, { sensitivity: 'base' }))
  return out
}
