import { ipcMain, dialog, BrowserWindow, type OpenDialogOptions } from 'electron'
import { IPC_CHANNELS } from '../../shared/ipc-channels'
import {
  IpcResponse,
  FileInfo,
  type SaveTextRequest,
  type SaveTextResult,
  type TextDocumentSnapshot,
  type WorkspaceOpenData,
  type WorkspaceFileEntry,
} from '../../shared/types'
import {
  FluxFileError,
  getFileInfo,
  readFile,
  readText,
  saveText,
  writeTextLegacy,
  detectEncoding,
} from '../services/file-service'
import { streamReadFile } from '../services/stream-reader'
import { cancelWorkspaceScan, startWorkspaceScan } from '../services/workspace-service'
import { ensureWorkspaceConfig } from '../services/workspace-config-service'
import fs from 'fs'
import path from 'path'

export function isValidFilePath(filePath: unknown): filePath is string {
  return typeof filePath === 'string' && filePath.length > 0
}

export function isOptionalWorkspaceRoot(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

export function registerFileHandlers(): void {
  const {
    FILE_OPEN,
    FILE_CREATE,
    FILE_OPEN_FOLDER,
    FILE_LIST_WORKSPACE_FILES,
    FILE_SCAN_WORKSPACE,
    FILE_CANCEL_WORKSPACE_SCAN,
    FILE_WORKSPACE_SCAN_EVENT,
    FILE_READ,
    FILE_READ_TEXT,
    FILE_READ_STREAM,
    FILE_INFO,
    FILE_WRITE,
    FILE_SAVE_TEXT,
  } = IPC_CHANNELS

  const toErrorResponse = (error: unknown): IpcResponse => {
    if (error instanceof FluxFileError) {
      return { success: false, error: error.message, code: error.code }
    }
    return { success: false, error: String(error) }
  }

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
    async (event, requestedRoot?: string): Promise<IpcResponse<WorkspaceOpenData | null> & { cancelled?: boolean }> => {
    try {
      if (isOptionalWorkspaceRoot(requestedRoot)) {
        const root = path.resolve(requestedRoot)
        if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
          return { success: false, error: 'Invalid workspace root' }
        }
        return { success: true, data: { root, files: [], workspaceConfig: ensureWorkspaceConfig(root) } }
      }
      const owner = BrowserWindow.fromWebContents(event.sender) ?? BrowserWindow.getFocusedWindow()
      const options: OpenDialogOptions = {
        title: '打开文件夹',
        properties: ['openDirectory'],
      }
      const result = owner
        ? await dialog.showOpenDialog(owner, options)
        : await dialog.showOpenDialog(options)

      if (result.canceled || result.filePaths.length === 0) {
        return { success: true, cancelled: true, data: null }
      }

      const root = result.filePaths[0]
      const workspaceConfig = ensureWorkspaceConfig(root)
      return { success: true, data: { root, files: [], workspaceConfig } }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  // ── FILE_LIST_WORKSPACE_FILES ── 刷新指定工作区内可编辑文件列表 ──
  ipcMain.handle(
    FILE_LIST_WORKSPACE_FILES,
    async (_event, root: string): Promise<IpcResponse<WorkspaceFileEntry[]>> => {
      try {
        if (!root || typeof root !== 'string') {
          return { success: false, error: 'Invalid workspace root' }
        }
        const files: WorkspaceFileEntry[] = []
        await new Promise<void>((resolve, reject) => {
          startWorkspaceScan(root, (event) => {
            if (event.status === 'batch' && event.entries) files.push(...event.entries)
            if (event.status === 'complete') resolve()
            if (event.status === 'cancelled') reject(new Error('Workspace scan cancelled'))
            if (event.status === 'error') reject(new Error(event.error ?? 'Workspace scan failed'))
          })
        })
        files.sort((a, b) => a.relativePath.localeCompare(b.relativePath, undefined, { sensitivity: 'base' }))
        return { success: true, data: files }
      } catch (err) {
        return { success: false, error: String(err) }
      }
    },
  )

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

  ipcMain.handle(FILE_READ_TEXT, async (_event, filePath: string): Promise<IpcResponse<TextDocumentSnapshot>> => {
    try {
      if (!isValidFilePath(filePath)) {
        return { success: false, error: 'Invalid file path', code: 'INVALID_DATA' }
      }
      return { success: true, data: readText(filePath) }
    } catch (error) {
      return toErrorResponse(error)
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

  ipcMain.handle(
    FILE_SAVE_TEXT,
    async (_event, request: SaveTextRequest): Promise<IpcResponse<SaveTextResult>> => {
      try {
        if (!request || typeof request !== 'object' || typeof request.filePath !== 'string' || typeof request.content !== 'string') {
          return { success: false, error: 'Invalid save request', code: 'INVALID_DATA' }
        }
        return { success: true, data: await saveText(request) }
      } catch (error) {
        return toErrorResponse(error)
      }
    },
  )

  ipcMain.handle(
    FILE_SCAN_WORKSPACE,
    async (event, root: string): Promise<IpcResponse<{ taskId: string }>> => {
      if (!isOptionalWorkspaceRoot(root) || !path.isAbsolute(root)) {
        return { success: false, error: 'Invalid workspace root', code: 'INVALID_DATA' }
      }
      const task = startWorkspaceScan(root, (payload) => {
        event.sender.send(FILE_WORKSPACE_SCAN_EVENT, payload)
      })
      return { success: true, data: task }
    },
  )

  ipcMain.handle(
    FILE_CANCEL_WORKSPACE_SCAN,
    async (_event, taskId: string): Promise<IpcResponse<{ cancelled: boolean }>> => {
      if (!taskId || typeof taskId !== 'string') {
        return { success: false, error: 'Invalid workspace scan task', code: 'INVALID_DATA' }
      }
      return { success: true, data: { cancelled: cancelWorkspaceScan(taskId) } }
    },
  )

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
        await writeTextLegacy(filePath, content)
        return { success: true }
      } catch (err) {
        return { success: false, error: String(err) }
      }
    },
  )
}
