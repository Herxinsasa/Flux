import fs from 'fs'
import path from 'path'
import log from '../logger'
import {
  formatSessionSummaryMarkdown,
  parseSessionSummaryMarkdown,
  type SessionSummaryFile,
} from '../../shared/session-summary'

const FLUX_DIR = '.flux'
const SUMMARY_FILE = 'session-summary.md'

export function sessionSummaryPath(workspaceRoot: string): string {
  return path.join(path.resolve(workspaceRoot), FLUX_DIR, SUMMARY_FILE)
}

export function readWorkspaceSession(workspaceRoot: string): SessionSummaryFile {
  const filePath = sessionSummaryPath(workspaceRoot)
  if (!fs.existsSync(filePath)) {
    return { pinnedFacts: [], workingSummary: null }
  }
  try {
    const raw = fs.readFileSync(filePath, 'utf8')
    return parseSessionSummaryMarkdown(raw)
  } catch (err) {
    log.warn('[session-summary] read failed', { filePath, err })
    return { pinnedFacts: [], workingSummary: null }
  }
}

export function writeWorkspaceSession(
  workspaceRoot: string,
  data: SessionSummaryFile,
): void {
  const dir = path.join(path.resolve(workspaceRoot), FLUX_DIR)
  const filePath = path.join(dir, SUMMARY_FILE)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(filePath, formatSessionSummaryMarkdown(data), 'utf8')
  log.info('[session-summary] wrote', { filePath })
}
