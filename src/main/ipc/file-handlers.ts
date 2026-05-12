import { ipcMain, dialog, BrowserWindow } from 'electron'
import { IPC_CHANNELS } from '../../shared/ipc-channels'
import { IpcResponse, FileInfo, type WorkspaceOpenData } from '../../shared/types'
import { getFileInfo, readFile, detectEncoding } from '../services/file-service'
import { streamReadFile } from '../services/stream-reader'
import { listWorkspaceFiles } from '../services/workspace-service'
import { ensureWorkspaceConfig } from '../services/workspace-config-service'
import fs from 'fs'
import path from 'path'

export function registerFileHandlers(): void {
  const { FILE_OPEN, FILE_CREATE, FILE_OPEN_FOLDER, FILE_READ, FILE_READ_STREAM, FILE_INFO, FILE_WRITE } =
    IPC_CHANNELS

  // ── FILE_OPEN ── open native file dialog, return selected path ──
  ipcMain.handle(FILE_OPEN, async (): Promise<IpcResponse<string | null>> => {
    try {
      const window = BrowserWindow.getFocusedWindow()
      const result = await dialog.showOpenDialog(window!, {
        title: 'Open File',
        properties: ['openFile'],
        filters: [
          { name: 'All Supported', extensions: ['md', 'json', 'txt', 'log', 'csv', 'xml', 'yaml', 'yml', 'js', 'ts', 'jsx', 'tsx', 'py', 'html', 'css'] },
          { name: 'Text Files', extensions: ['txt', 'log', 'csv', 'md'] },
          { name: 'Code Files', extensions: ['js', 'ts', 'jsx', 'tsx', 'py', 'json', 'html', 'css'] },
          { name: 'All Files', extensions: ['*'] },
        ],
      })

      if (result.canceled || result.filePaths.length === 0) {
        return { success: true, data: null }
      }

      return { success: true, data: result.filePaths[0] }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  // ── FILE_CREATE ── choose save path/name/type then create an empty file ──
  ipcMain.handle(
    FILE_CREATE,
    async (): Promise<IpcResponse<string | null> & { cancelled?: boolean }> => {
      try {
        const window = BrowserWindow.getFocusedWindow()
        const result = await dialog.showSaveDialog(window!, {
          title: '新建文件',
          defaultPath: 'untitled.md',
          filters: [
            { name: 'Markdown', extensions: ['md'] },
            { name: 'Text', extensions: ['txt'] },
            { name: 'TypeScript', extensions: ['ts'] },
            { name: 'JavaScript', extensions: ['js'] },
            { name: 'Python', extensions: ['py'] },
            { name: 'JSON', extensions: ['json'] },
            { name: 'All Files', extensions: ['*'] },
          ],
        })

        if (result.canceled || !result.filePath) {
          return { success: true, cancelled: true, data: null }
        }

        const targetPath = path.resolve(result.filePath)
        const dir = path.dirname(targetPath)
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true })
        }

        // 用户在保存对话框确认“替换”后，需要真正覆盖为一个空文件。
        fs.writeFileSync(targetPath, '', 'utf-8')

        return { success: true, data: targetPath }
      } catch (err) {
        return { success: false, error: String(err) }
      }
    },
  )

  // ── FILE_OPEN_FOLDER ── 选择文件夹并列出可编辑文件 ──
  ipcMain.handle(
    FILE_OPEN_FOLDER,
    async (): Promise<IpcResponse<WorkspaceOpenData | null> & { cancelled?: boolean }> => {
    try {
      const window = BrowserWindow.getFocusedWindow()
      const result = await dialog.showOpenDialog(window!, {
        title: '打开文件夹',
        properties: ['openDirectory'],
      })

      if (result.canceled || result.filePaths.length === 0) {
        return { success: true, cancelled: true, data: null }
      }

      const root = result.filePaths[0]
      const files = listWorkspaceFiles(root)
      const workspaceConfig = ensureWorkspaceConfig(root)
      return { success: true, data: { root, files, workspaceConfig } }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  // ── FILE_READ ── read file content (full load for all sizes) ──
  ipcMain.handle(FILE_READ, async (_event, filePath: string): Promise<IpcResponse<{ content: string; encoding: string }>> => {
    try {
      if (!filePath || typeof filePath !== 'string') {
        return { success: false, error: 'Invalid file path' }
      }
      const result = readFile(filePath)
      return { success: true, data: result }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  // ── FILE_READ_STREAM ── stream chunks back to renderer ──
  // The renderer sends an ipcRenderer.send() to trigger streaming,
  // then listens on `file:read-stream:<path>` for chunks.
  // A null chunk signals end-of-stream.
  // Encoding is auto-detected from the first 64KB of the file.
  ipcMain.on(FILE_READ_STREAM, (event, filePath: string) => {
    const channel = `${FILE_READ_STREAM}:${filePath}`

    try {
      if (!filePath || typeof filePath !== 'string') {
        event.sender.send(channel, { error: 'Invalid file path' })
        return
      }

      // Detect encoding from the first chunk of the file
      let encoding = 'utf8'
      try {
        const probeSize = Math.min(fs.statSync(filePath).size, 64 * 1024)
        const fd = fs.openSync(filePath, 'r')
        const probeBuffer = Buffer.alloc(probeSize)
        fs.readSync(fd, probeBuffer, 0, probeSize, 0)
        fs.closeSync(fd)
        encoding = detectEncoding(probeBuffer)
      } catch {
        // If detection fails, fall back to UTF-8
      }

      const cancel = streamReadFile(
        filePath,
        encoding,
        (chunk: string) => {
          event.sender.send(channel, chunk)
        },
        () => {
          event.sender.send(channel, null) // end marker
        },
        (err: Error) => {
          event.sender.send(channel, { error: err.message })
        },
      )

      // Store the cancel function so a future cancel request can stop it.
      // For simplicity, we attach a one-time listener for cancellation.
      const cancelChannel = `${FILE_READ_STREAM}:cancel:${filePath}`
      ipcMain.once(cancelChannel, () => {
        cancel()
      })
    } catch (err) {
      event.sender.send(channel, { error: String(err) })
    }
  })

  // ── FILE_INFO ── return file metadata ──
  ipcMain.handle(FILE_INFO, async (_event, filePath: string): Promise<IpcResponse<FileInfo>> => {
    try {
      if (!filePath || typeof filePath !== 'string') {
        return { success: false, error: 'Invalid file path' }
      }
      const info = getFileInfo(filePath)
      return { success: true, data: info }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  // ── FILE_WRITE ── 保存编辑器当前文件（用户 Ctrl+S；不限于工作区内路径） ──
  ipcMain.handle(
    FILE_WRITE,
    async (_event, filePath: string, content: string): Promise<IpcResponse<void>> => {
      try {
        if (!filePath || typeof filePath !== 'string') {
          return { success: false, error: 'Invalid file path' }
        }
        if (typeof content !== 'string') {
          return { success: false, error: 'Invalid content' }
        }
        const resolved = path.resolve(filePath)
        const dir = path.dirname(resolved)
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true })
        }
        fs.writeFileSync(resolved, content, 'utf-8')
        return { success: true }
      } catch (err) {
        return { success: false, error: String(err) }
      }
    },
  )
}
