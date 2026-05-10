import { registerFileHandlers } from './file-handlers'
import { registerSettingsHandlers } from './settings-handlers'
import { registerAgentHandlers } from './agent-handlers'
import { registerSkillHandlers } from './skill-handlers'
import { registerExportHandlers } from './export-handlers'
import { registerEditorHandlers } from './editor-handlers'
import { SkillManager } from '../skill/skill-manager'

export function registerAllHandlers(): void {
  // Initialize skill manager first (loads built-in + user skills)
  SkillManager.getInstance().init()

  registerFileHandlers()
  registerSettingsHandlers()
  registerAgentHandlers()
  registerEditorHandlers()
  registerSkillHandlers()
  registerExportHandlers()
}
