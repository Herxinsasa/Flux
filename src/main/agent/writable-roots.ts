import path from 'path'
import { app } from 'electron'
import { getUserSkillsRoot } from '../paths'

/** 与 agent IPC SendContext 对齐的可写字段 */
export interface WritableRootsInput {
  workspaceRoot?: string | null
  /** 渲染进程传入的额外允许目录（已打开标签、@ 附件所在目录等），绝对路径 */
  writableRootsExtra?: string[]
  openFiles?: Array<{ path: string }>
}

export function collectWritableRoots(input?: WritableRootsInput): string[] {
  const roots = new Set<string>()
  const add = (p?: string | null) => {
    if (!p || typeof p !== 'string' || !p.trim()) return
    try {
      roots.add(path.resolve(p.trim()))
    } catch {
      roots.add(p.trim())
    }
  }

  add(input?.workspaceRoot ?? undefined)
  add(app.getPath('userData'))

  try {
    add(getUserSkillsRoot())
  } catch {
    /* ignore */
  }

  for (const x of input?.writableRootsExtra ?? []) {
    add(x)
  }

  for (const f of input?.openFiles ?? []) {
    try {
      add(path.dirname(path.resolve(f.path)))
    } catch {
      /* ignore */
    }
  }

  return [...roots]
}

/**
 * Agent 读取范围比写入范围更窄：不暴露应用用户数据和已安装 Skill 目录。
 * 允许当前工作区、打开文件及用户显式附带路径，避免工具读取任意本地文件。
 */
export function collectReadableRoots(input?: WritableRootsInput): string[] {
  const roots = new Set<string>()
  const add = (p?: string | null) => {
    if (!p || typeof p !== 'string' || !p.trim()) return
    try {
      roots.add(path.resolve(p.trim()))
    } catch {
      roots.add(p.trim())
    }
  }

  add(input?.workspaceRoot ?? undefined)
  for (const x of input?.writableRootsExtra ?? []) {
    add(x)
  }
  for (const f of input?.openFiles ?? []) {
    try {
      add(path.dirname(path.resolve(f.path)))
    } catch {
      /* ignore */
    }
  }

  return [...roots]
}

export function isPathUnderWritableRoots(resolvedFilePath: string, roots: string[]): boolean {
  if (roots.length === 0) return false
  const norm = path.normalize(resolvedFilePath)
  const lower = norm.toLowerCase()
  for (const root of roots) {
    try {
      const r = path.normalize(path.resolve(root)).toLowerCase()
      const sep = path.sep.toLowerCase()
      if (lower === r || lower.startsWith(r + sep)) return true
    } catch {
      /* ignore */
    }
  }
  return false
}
