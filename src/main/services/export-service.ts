import { dialog, BrowserWindow } from 'electron'
import fs from 'fs'
import log from '../logger'

/**
 * Open a native save dialog and write the given content to the selected file path.
 * Returns the saved file path, or null if the user cancelled.
 */
export async function saveReportFile(
  content: string,
  defaultFilename: string,
): Promise<string | null> {
  const window = BrowserWindow.getFocusedWindow()
  if (!window) {
    log.warn('saveReportFile: no focused window')
    return null
  }

  const result = await dialog.showSaveDialog(window, {
    title: '导出分析报告',
    defaultPath: defaultFilename,
    filters: [
      { name: 'Markdown Files', extensions: ['md'] },
      { name: 'All Files', extensions: ['*'] },
    ],
  })

  if (result.canceled || !result.filePath) {
    return null
  }

  fs.writeFileSync(result.filePath, content, 'utf-8')
  log.info('Report saved to:', result.filePath)
  return result.filePath
}
