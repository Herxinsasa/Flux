import { extname, isAbsolute, resolve } from 'path'

const OPENABLE_EXTENSIONS = new Set(['.md', '.markdown', '.txt', '.log'])
const OPTIONS_WITH_VALUES = new Set(['--user-data-dir', '--log-file'])

export function extractOpenFilePath(commandLine: string[], workingDirectory = process.cwd()): string | null {
  let skipNext = false
  for (const candidate of commandLine) {
    if (skipNext) {
      skipNext = false
      continue
    }
    if (OPTIONS_WITH_VALUES.has(candidate)) {
      skipNext = true
      continue
    }
    if (candidate.startsWith('-') || !OPENABLE_EXTENSIONS.has(extname(candidate).toLowerCase())) continue
    return isAbsolute(candidate) ? resolve(candidate) : resolve(workingDirectory, candidate)
  }
  return null
}
