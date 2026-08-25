import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { IPC_CHANNELS } from '../shared/ipc-channels'
import { buildLocalMediaUrl } from '../shared/local-media-url'
import type { SaveTextRequest } from '../shared/types'
import type { ReviewExportRequest, ReviewLoadRequest, ReviewSaveRequest } from '../shared/review'

const electronAPI = {
  app: {
    getVersion: () => ipcRenderer.invoke(IPC_CHANNELS.APP_GET_VERSION),
    onOpenFile: (callback: (filePath: string) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, filePath: string) => callback(filePath)
      ipcRenderer.on(IPC_CHANNELS.APP_OPEN_FILE, listener)
      return () => ipcRenderer.removeListener(IPC_CHANNELS.APP_OPEN_FILE, listener)
    },
    onCloseRequest: (callback: () => void) => {
      const listener = () => callback()
      ipcRenderer.on(IPC_CHANNELS.APP_CLOSE_REQUEST, listener)
      return () => ipcRenderer.removeListener(IPC_CHANNELS.APP_CLOSE_REQUEST, listener)
    },
    approveClose: () => ipcRenderer.send(IPC_CHANNELS.APP_CLOSE_APPROVED),
  },
  recent: {
    list: () => ipcRenderer.invoke(IPC_CHANNELS.RECENT_LIST),
    record: (itemPath: string, kind: 'file' | 'folder') =>
      ipcRenderer.invoke(IPC_CHANNELS.RECENT_RECORD, itemPath, kind),
    remove: (itemPath: string) => ipcRenderer.invoke(IPC_CHANNELS.RECENT_REMOVE, itemPath),
  },
  review: {
    load: (request: ReviewLoadRequest) => ipcRenderer.invoke(IPC_CHANNELS.REVIEW_LOAD, request),
    save: (request: ReviewSaveRequest) => ipcRenderer.invoke(IPC_CHANNELS.REVIEW_SAVE, request),
    export: (request: ReviewExportRequest) => ipcRenderer.invoke(IPC_CHANNELS.REVIEW_EXPORT, request),
  },
  attachment: {
    saveImage: (request: import('../shared/attachment-backup').SaveImageAttachmentRequest) =>
      ipcRenderer.invoke(IPC_CHANNELS.ATTACHMENT_SAVE_IMAGE, request),
  },
  backup: {
    create: (input: import('../shared/attachment-backup').BackupSnapshotInput) => ipcRenderer.invoke(IPC_CHANNELS.BACKUP_CREATE, input),
    list: (sourcePath?: string) => ipcRenderer.invoke(IPC_CHANNELS.BACKUP_LIST, sourcePath),
    read: (snapshotId: string) => ipcRenderer.invoke(IPC_CHANNELS.BACKUP_READ, snapshotId),
    recoveries: (sourcePath?: string) => ipcRenderer.invoke(IPC_CHANNELS.BACKUP_RECOVERIES, sourcePath),
    discard: (snapshotId: string) => ipcRenderer.invoke(IPC_CHANNELS.BACKUP_DISCARD, snapshotId),
    saveAs: (request: import('../shared/attachment-backup').SaveBackupAsRequest) => ipcRenderer.invoke(IPC_CHANNELS.BACKUP_SAVE_AS, request),
  },
  file: {
    open: () => ipcRenderer.invoke(IPC_CHANNELS.FILE_OPEN),
    create: () => ipcRenderer.invoke(IPC_CHANNELS.FILE_CREATE),
    openFolder: (root?: string) => ipcRenderer.invoke(IPC_CHANNELS.FILE_OPEN_FOLDER, root),
    listWorkspaceFiles: (root: string) => ipcRenderer.invoke(IPC_CHANNELS.FILE_LIST_WORKSPACE_FILES, root),
    scanWorkspace: (root: string) => ipcRenderer.invoke(IPC_CHANNELS.FILE_SCAN_WORKSPACE, root),
    cancelWorkspaceScan: (taskId: string) => ipcRenderer.invoke(IPC_CHANNELS.FILE_CANCEL_WORKSPACE_SCAN, taskId),
    onWorkspaceScan: (callback: (event: import('../shared/types').WorkspaceScanEvent) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, payload: import('../shared/types').WorkspaceScanEvent) => callback(payload)
      ipcRenderer.on(IPC_CHANNELS.FILE_WORKSPACE_SCAN_EVENT, listener)
      return () => ipcRenderer.removeListener(IPC_CHANNELS.FILE_WORKSPACE_SCAN_EVENT, listener)
    },
    watchWorkspace: (root: string) => ipcRenderer.invoke(IPC_CHANNELS.FILE_WATCH_WORKSPACE, root),
    stopWorkspaceWatch: (watchId: string) => ipcRenderer.invoke(IPC_CHANNELS.FILE_STOP_WORKSPACE_WATCH, watchId),
    onWorkspaceChange: (callback: (event: import('../shared/types').WorkspaceChangeEvent) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, payload: import('../shared/types').WorkspaceChangeEvent) => callback(payload)
      ipcRenderer.on(IPC_CHANNELS.FILE_WORKSPACE_CHANGE_EVENT, listener)
      return () => ipcRenderer.removeListener(IPC_CHANNELS.FILE_WORKSPACE_CHANGE_EVENT, listener)
    },
    read: (filePath: string) => ipcRenderer.invoke(IPC_CHANNELS.FILE_READ, filePath),
    readText: (filePath: string) => ipcRenderer.invoke(IPC_CHANNELS.FILE_READ_TEXT, filePath),
    readStream: (filePath: string, callback: (chunk: string | null) => void) => {
      const channel = `${IPC_CHANNELS.FILE_READ_STREAM}:${filePath}`
      const listener = (_event: Electron.IpcRendererEvent, chunk: string | null) => callback(chunk)
      ipcRenderer.on(channel, listener)
      // Trigger the stream on the main process
      ipcRenderer.send(IPC_CHANNELS.FILE_READ_STREAM, filePath)
      // Return an unsubscribe function
      return () => {
        ipcRenderer.send(`${IPC_CHANNELS.FILE_READ_STREAM}:cancel:${filePath}`)
        ipcRenderer.removeListener(channel, listener)
      }
    },
    getInfo: (filePath: string) => ipcRenderer.invoke(IPC_CHANNELS.FILE_INFO, filePath),
    write: (filePath: string, content: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.FILE_WRITE, filePath, content),
    saveText: (request: SaveTextRequest) => ipcRenderer.invoke(IPC_CHANNELS.FILE_SAVE_TEXT, request),
    getFilePath: (file: File) => webUtils.getPathForFile(file),
  },
  settings: {
    save: (settings: Record<string, unknown>) => ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_SAVE, settings),
    get: () => ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_GET),
    testConnection: (config: unknown) => ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_TEST_CONNECTION, config),
    listModels: (config: unknown) => ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_LIST_MODELS, config),
  },
  agent: {
    send: (message: string, context?: unknown) => ipcRenderer.invoke(IPC_CHANNELS.AGENT_SEND, message, context),
    cancel: () => ipcRenderer.invoke(IPC_CHANNELS.AGENT_CANCEL),
    onStream: (callback: (token: string) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, token: string) => callback(token)
      ipcRenderer.on(IPC_CHANNELS.AGENT_STREAM, listener)
      return () => {
        ipcRenderer.removeListener(IPC_CHANNELS.AGENT_STREAM, listener)
      }
    },
  },
  aiAction: {
    run: (request: import('../shared/ai-action').AiActionRequest) =>
      ipcRenderer.invoke(IPC_CHANNELS.AI_ACTION_RUN, request),
    cancel: (sourcePath: string, requestId: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.AI_ACTION_CANCEL, sourcePath, requestId),
  },
  skill: {
    import: () => ipcRenderer.invoke(IPC_CHANNELS.SKILL_IMPORT),
    importFolder: () => ipcRenderer.invoke(IPC_CHANNELS.SKILL_IMPORT_FOLDER),
    list: () => ipcRenderer.invoke(IPC_CHANNELS.SKILL_LIST),
    get: (name: string) => ipcRenderer.invoke(IPC_CHANNELS.SKILL_GET, name),
    save: (skill: unknown) => ipcRenderer.invoke(IPC_CHANNELS.SKILL_SAVE, skill),
    toggle: (skillId: string, enabled: boolean) => ipcRenderer.invoke(IPC_CHANNELS.SKILL_TOGGLE, skillId, enabled),
    delete: (name: string) => ipcRenderer.invoke(IPC_CHANNELS.SKILL_DELETE, name),
  },
  editor: {
    jumpToLine: (line: number, filePath?: string) => ipcRenderer.invoke(IPC_CHANNELS.EDITOR_JUMP_TO_LINE, line, filePath),
    previewChange: (change: unknown) => ipcRenderer.invoke(IPC_CHANNELS.EDITOR_PREVIEW_CHANGE, change),
    applyChange: (changeId: string) => ipcRenderer.invoke(IPC_CHANNELS.EDITOR_APPLY_CHANGE, changeId),
    rejectChange: (changeId: string) => ipcRenderer.invoke(IPC_CHANNELS.EDITOR_REJECT_CHANGE, changeId),
    applyTransaction: (transactionId: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.EDITOR_APPLY_TRANSACTION, transactionId),
    rejectTransaction: (transactionId: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.EDITOR_REJECT_TRANSACTION, transactionId),
    onChangeApplied: (
      callback: (payload: {
        changeId: string
        transactionId?: string
        filePath: string
        content: string
        startLine: number
        endLine: number
        changed: boolean
      }) => void,
    ) => {
      const listener = (_event: Electron.IpcRendererEvent, payload: {
        changeId: string
        filePath: string
        content: string
        startLine: number
        endLine: number
        changed: boolean
      }) => callback(payload)
      ipcRenderer.on(IPC_CHANNELS.EDITOR_CHANGE_APPLIED, listener)
      return () => {
        ipcRenderer.removeListener(IPC_CHANNELS.EDITOR_CHANGE_APPLIED, listener)
      }
    },
  },
  export: {
    report: (content: string, defaultName: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.EXPORT_REPORT, content, defaultName),
  },
  log: {
    getIndex: (filePath: string) => ipcRenderer.invoke(IPC_CHANNELS.LOG_GET_INDEX, filePath),
    index: (filePath: string) => ipcRenderer.invoke(IPC_CHANNELS.LOG_INDEX, filePath),
    cancelIndex: (taskId: string) => ipcRenderer.invoke(IPC_CHANNELS.LOG_CANCEL_INDEX, taskId),
    onIndex: (callback: (event: import('../shared/types').LogIndexTaskEvent) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, payload: import('../shared/types').LogIndexTaskEvent) => callback(payload)
      ipcRenderer.on(IPC_CHANNELS.LOG_INDEX_EVENT, listener)
      return () => ipcRenderer.removeListener(IPC_CHANNELS.LOG_INDEX_EVENT, listener)
    },
    readLines: (filePath: string, offset: number, limit: number) =>
      ipcRenderer.invoke(IPC_CHANNELS.LOG_READ_LINES, filePath, offset, limit),
    evictIndex: (filePath: string) => ipcRenderer.invoke(IPC_CHANNELS.LOG_EVICT_INDEX, filePath),
  },
  workspace: {
    readSession: (workspaceRoot: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.WORKSPACE_SESSION_READ, workspaceRoot),
    writeSession: (workspaceRoot: string, payload: unknown) =>
      ipcRenderer.invoke(IPC_CHANNELS.WORKSPACE_SESSION_WRITE, workspaceRoot, payload),
    session: {
      create: (input: unknown) => ipcRenderer.invoke(IPC_CHANNELS.SESSION_CREATE, input),
      list: (workspaceRoot: string) => ipcRenderer.invoke(IPC_CHANNELS.SESSION_LIST, workspaceRoot),
      load: (workspaceRoot: string, sessionId: string) => ipcRenderer.invoke(IPC_CHANNELS.SESSION_LOAD, workspaceRoot, sessionId),
      append: (input: unknown) => ipcRenderer.invoke(IPC_CHANNELS.SESSION_APPEND, input),
      checkpoint: (input: unknown) => ipcRenderer.invoke(IPC_CHANNELS.SESSION_CHECKPOINT, input),
      usage: () => ipcRenderer.invoke(IPC_CHANNELS.SESSION_USAGE),
      cleanup: (options: unknown) => ipcRenderer.invoke(IPC_CHANNELS.SESSION_CLEANUP, options),
      clear: (protectedSessionIds?: string[]) => ipcRenderer.invoke(IPC_CHANNELS.SESSION_CLEAR, protectedSessionIds),
    },
  },
  media: {
    toLocalUrl: (absolutePath: string) => buildLocalMediaUrl(absolutePath),
  },
  shell: {
    openExternal: (url: string) => ipcRenderer.invoke(IPC_CHANNELS.SHELL_OPEN_EXTERNAL, url),
  },
}

contextBridge.exposeInMainWorld('electronAPI', electronAPI)
