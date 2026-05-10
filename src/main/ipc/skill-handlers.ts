import { ipcMain, dialog, BrowserWindow } from 'electron'
import { IPC_CHANNELS } from '../../shared/ipc-channels'
import { SkillManager } from '../skill/skill-manager'
import type { Skill, SkillMeta } from '../../shared/types'
import * as fs from 'fs'
import log from '../logger'

export function registerSkillHandlers(): void {
  const { SKILL_LIST, SKILL_IMPORT, SKILL_IMPORT_FOLDER, SKILL_GET, SKILL_SAVE, SKILL_TOGGLE, SKILL_DELETE } =
    IPC_CHANNELS

  // -- SKILL_LIST: return all skills as metadata ---
  ipcMain.handle(SKILL_LIST, async () => {
    try {
      const manager = SkillManager.getInstance()
      const raw = manager.list()
      const seen = new Set<string>()
      const skills: SkillMeta[] = []
      for (const m of raw) {
        if (seen.has(m.name)) continue
        seen.add(m.name)
        skills.push(m)
      }
      return { success: true, data: skills }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      log.error(`SKILL_LIST failed: ${message}`)
      return { success: false, error: message }
    }
  })

  // -- SKILL_GET: return full skill content by name ---
  ipcMain.handle(SKILL_GET, async (_event, name: string) => {
    try {
      const manager = SkillManager.getInstance()
      const skill: Skill | undefined = manager.get(name)
      if (!skill) {
        return { success: false, error: `Skill "${name}" 不存在` }
      }
      return { success: true, data: skill }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      log.error(`SKILL_GET failed: ${message}`)
      return { success: false, error: message }
    }
  })

  // -- SKILL_SAVE: persist a user skill's content ---
  ipcMain.handle(SKILL_SAVE, async (_event, skill: Skill) => {
    try {
      const manager = SkillManager.getInstance()
      // Only user skills can be saved (builtins are read-only)
      const existing = manager.get(skill.name)
      if (!existing) {
        return { success: false, error: `Skill "${skill.name}" 不存在` }
      }
      if (existing.builtin) {
        return { success: false, error: '内置 Skill 不可编辑' }
      }

      // Write updated content back to file
      const lines: string[] = ['---']
      lines.push(`name: ${skill.name}`)
      if (skill.description) lines.push(`description: ${skill.description}`)
      if (skill.keywords.length > 0) {
        lines.push(`keywords: [${skill.keywords.join(', ')}]`)
      }
      lines.push('---')
      lines.push('')
      lines.push(skill.content)

      fs.writeFileSync(existing.filePath, lines.join('\n'), 'utf-8')

      // 与磁盘同步（含目录型技能包，勿再走 import 单文件逻辑）
      existing.description = skill.description
      existing.keywords = skill.keywords ?? []
      existing.content = skill.content

      return { success: true }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      log.error(`SKILL_SAVE failed: ${message}`)
      return { success: false, error: message }
    }
  })

  // -- SKILL_IMPORT: open file dialog and import selected .md file ---
  ipcMain.handle(SKILL_IMPORT, async (event) => {
    try {
      const senderWindow = BrowserWindow.fromWebContents(event.sender)
      if (!senderWindow) {
        return { success: false, error: 'No window found' }
      }

      const result = await dialog.showOpenDialog(senderWindow, {
        title: '选择 Skill 文件',
        filters: [
          { name: 'Markdown Files', extensions: ['md'] },
          { name: 'All Files', extensions: ['*'] },
        ],
        properties: ['openFile'],
      })

      if (result.canceled || result.filePaths.length === 0) {
        /* 用户关闭对话框：静默成功，前端不提示错误 */
        return { success: true, cancelled: true }
      }

      const filePath = result.filePaths[0]
      const manager = SkillManager.getInstance()
      const sourceName = filePath.split(/[/\\]/).pop() ?? undefined
      const importedName = manager.import(filePath, { sourceName })

      if (!importedName) {
        return { success: false, error: '导入失败：文件缺少有效的 YAML frontmatter 或与其他 Skill 冲突' }
      }

      const skill = manager.get(importedName)
      if (!skill) {
        return { success: false, error: '导入成功但查询失败' }
      }

      return { success: true, data: importedName }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      log.error(`SKILL_IMPORT failed: ${message}`)
      return { success: false, error: message }
    }
  })

  // -- SKILL_IMPORT_FOLDER: import a directory as a skill package (scripts + templates) ---
  ipcMain.handle(SKILL_IMPORT_FOLDER, async (event) => {
    try {
      const senderWindow = BrowserWindow.fromWebContents(event.sender)
      if (!senderWindow) {
        return { success: false, error: 'No window found' }
      }

      const result = await dialog.showOpenDialog(senderWindow, {
        title: '选择 Skill 所在文件夹（内含 SKILL.md 或带 frontmatter 的 .md）',
        properties: ['openDirectory'],
      })

      if (result.canceled || result.filePaths.length === 0) {
        return { success: true, cancelled: true }
      }

      const dirPath = result.filePaths[0]
      const manager = SkillManager.getInstance()
      const importedName = manager.importDirectory(dirPath)

      if (!importedName) {
        return {
          success: false,
          error: '导入失败：未找到有效入口 Markdown（需含 YAML name），或与内置 Skill 重名',
        }
      }

      return { success: true, data: importedName }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      log.error(`SKILL_IMPORT_FOLDER failed: ${message}`)
      return { success: false, error: message }
    }
  })

  // -- SKILL_TOGGLE: enable/disable a skill ---
  ipcMain.handle(SKILL_TOGGLE, async (_event, name: string, enabled: boolean) => {
    try {
      const manager = SkillManager.getInstance()
      const ok = manager.toggle(name, enabled)
      if (!ok) {
        return { success: false, error: `Skill "${name}" 不存在` }
      }
      return { success: true }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      log.error(`SKILL_TOGGLE failed: ${message}`)
      return { success: false, error: message }
    }
  })

  // -- SKILL_DELETE: remove a user skill from assembly ---
  ipcMain.handle(SKILL_DELETE, async (_event, name: string) => {
    try {
      const manager = SkillManager.getInstance()
      const skill = manager.get(name)
      if (!skill) {
        return { success: false, error: `Skill "${name}" 不存在` }
      }
      if (skill.builtin) {
        return { success: false, error: '内置 Skill 不可删除' }
      }
      const result = manager.delete(name)
      if (!result.ok) {
        return { success: false, error: result.error ?? `Skill "${name}" 删除失败` }
      }
      return { success: true }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      log.error(`SKILL_DELETE failed: ${message}`)
      return { success: false, error: message }
    }
  })
}
