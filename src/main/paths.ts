import fs from 'fs'
import path from 'path'
import { app } from 'electron'

export type ReleaseMode = 'installed' | 'portable'

/** Packaged resource root; retained for bundled read-only resources. */
export function getWorkRoot(): string {
  if (app.isPackaged) {
    return path.dirname(process.execPath)
  }
  return process.cwd()
}

export function getReleaseMode(): ReleaseMode {
  if (
    process.env.FLUX_PORTABLE === '1' ||
    process.env.PORTABLE_EXECUTABLE_DIR ||
    process.env.PORTABLE_EXECUTABLE_FILE
  ) {
    return 'portable'
  }
  return 'installed'
}

function getPortableRoot(): string {
  if (process.env.PORTABLE_EXECUTABLE_DIR) {
    return path.resolve(process.env.PORTABLE_EXECUTABLE_DIR)
  }
  if (process.env.PORTABLE_EXECUTABLE_FILE) {
    return path.dirname(path.resolve(process.env.PORTABLE_EXECUTABLE_FILE))
  }
  return path.dirname(process.execPath)
}

/** Private writable data root, selected only by explicit release mode. */
export function getPrivateDataRoot(): string {
  const root = getReleaseMode() === 'portable'
    ? path.join(getPortableRoot(), 'data')
    : app.getPath('userData')
  fs.mkdirSync(root, { recursive: true })
  return root
}

function getPrivateDir(name: string): string {
  const dir = path.join(getPrivateDataRoot(), name)
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

export function getConfigDir(): string {
  return getPrivateDir('config')
}

export function getCacheDir(): string {
  return getPrivateDir('cache')
}

export function getBackupCacheDir(): string {
  return getPrivateDir('backup-cache')
}

export function getSessionsDir(): string {
  return getPrivateDir('sessions')
}

export function getLogsDir(): string {
  return getPrivateDir('logs')
}

/** Read-only Skill directory bundled with the application. */
export function getBuiltinSkillsDir(): string {
  return path.join(app.getAppPath(), 'skills')
}

export function getUserSkillsRoot(): string {
  return getPrivateDir('skills')
}

export function getUserSkillPackagesDir(): string {
  const dir = path.join(getUserSkillsRoot(), 'packages')
  fs.mkdirSync(dir, { recursive: true })
  return dir
}
