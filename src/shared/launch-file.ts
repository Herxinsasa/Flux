import { existsSync } from 'fs'
import { extname, isAbsolute, resolve } from 'path'

const OPENABLE_EXTENSIONS = new Set(['.md', '.markdown', '.txt', '.log'])

export function extractOpenFilePath(commandLine: string[]): string | null {
  for (const candidate of commandLine) {
    if (!isAbsolute(candidate) || !OPENABLE_EXTENSIONS.has(extname(candidate).toLowerCase())) continue
    const filePath = resolve(candidate)
    if (existsSync(filePath)) return filePath
  }
  return null
}
