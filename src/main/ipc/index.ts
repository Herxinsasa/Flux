import { registerFileHandlers } from './file-handlers'
import { registerSettingsHandlers } from './settings-handlers'
import { registerAgentHandlers } from './agent-handlers'
import { registerSkillHandlers } from './skill-handlers'
import { registerExportHandlers } from './export-handlers'
import { registerEditorHandlers } from './editor-handlers'
import { registerLogHandlers } from './log-handlers'
import { registerSessionHandlers } from './session-handlers'
import { registerShellHandlers } from './shell-handlers'
import { registerRecentHandlers } from './recent-handlers'
import { registerReviewHandlers } from './review-handlers'
import { registerAiActionHandlers } from './ai-action-handlers'
import { registerAttachmentBackupHandlers } from './attachment-backup-handlers'

export function registerAllHandlers(): void {
  registerFileHandlers()
  registerAttachmentBackupHandlers()
  registerRecentHandlers()
  registerReviewHandlers()
  registerAiActionHandlers()
  registerSettingsHandlers()
  registerAgentHandlers()
  registerEditorHandlers()
  registerSkillHandlers()
  registerExportHandlers()
  registerLogHandlers()
  registerSessionHandlers()
  registerShellHandlers()
}
