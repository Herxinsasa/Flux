import fs from 'fs'
import path from 'path'
import { app } from 'electron'

/**
 * 工作根目录：打包后为可执行文件所在目录；开发时为进程 cwd（一般在项目根执行 npm run dev）。
 */
export function getWorkRoot(): string {
  if (app.isPackaged) {
    return path.dirname(process.execPath)
  }
  return process.cwd()
}

function ensureWritableDir(primary: string, fallback: string): string {
  try {
    fs.mkdirSync(primary, { recursive: true })
    fs.accessSync(primary, fs.constants.W_OK)
    return primary
  } catch {
    fs.mkdirSync(fallback, { recursive: true })
    return fallback
  }
}

/** 内置 Skill 目录（只读，随应用打包，位于 app.getAppPath()/skills） */
export function getBuiltinSkillsDir(): string {
  return path.join(app.getAppPath(), 'skills')
}

/** flux-settings.json 所在目录（自动创建） */
export function getConfigDir(): string {
  const primary = path.join(getWorkRoot(), 'config')
  const fallback = path.join(app.getPath('userData'), 'config')
  return ensureWritableDir(primary, fallback)
}

/**
 * 用户导入的 Skill 根目录（与 config 同级策略：工作目录下 skills/）。
 *
 * 若工作目录下的 skills/ 与内置目录为同一路径（常见于在 flux-app 根目录运行 npm run dev），
 * 则不得用作「用户导入」扫描区，否则会与内置 skills/*.md 重叠扫描，列表中出现重复。
 * 此时固定使用 userData/skills。
 */
export function getUserSkillsRoot(): string {
  const primary = path.join(getWorkRoot(), 'skills')
  const primaryIsolated = path.join(getWorkRoot(), 'skills-user')
  const fallback = path.join(app.getPath('userData'), 'skills')
  const resolvedPrimary = path.resolve(primary)
  const resolvedBuiltin = path.resolve(getBuiltinSkillsDir())

  if (resolvedPrimary === resolvedBuiltin) {
    // 开发态常见：workRoot/skills 与内置目录重合。改用 workRoot/skills-user，
    // 避免重复扫描内置技能，同时尽量不回落到 userData（通常在 C 盘）。
    return ensureWritableDir(primaryIsolated, fallback)
  }

  return ensureWritableDir(primary, fallback)
}

export function getUserSkillPackagesDir(): string {
  const root = getUserSkillsRoot()
  const pkg = path.join(root, 'packages')
  fs.mkdirSync(pkg, { recursive: true })
  return pkg
}
