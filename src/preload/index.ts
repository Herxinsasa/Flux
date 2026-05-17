import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { IPC_CHANNELS } from '../shared/ipc-channels'

const electronAPI = {
  app: {
    getVersion: () => ipcRenderer.invoke(IPC_CHANNELS.APP_GET_VERSION),
  },
  file: {
    open: () => ipcRenderer.invoke(IPC_CHANNELS.FILE_OPEN),
    create: () => ipcRenderer.invoke(IPC_CHANNELS.FILE_CREATE),
    openFolder: () => ipcRenderer.invoke(IPC_CHANNELS.FILE_OPEN_FOLDER),
    listWorkspaceFiles: (root: string) => ipcRenderer.invoke(IPC_CHANNELS.FILE_LIST_WORKSPACE_FILES, root),
    read: (filePath: string) => ipcRenderer.invoke(IPC_CHANNELS.FILE_READ, filePath),
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
    getFilePath: (file: File) => webUtils.getPathForFile(file),
  },
  settings: {
    save: (settings: Record<string, unknown>) => ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_SAVE, settings),
    get: () => ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_GET),
    testConnection: (config: unknown) => ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_TEST_CONNECTION, config),
    workspaceVerify: (workspaceRoot: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_WORKSPACE_VERIFY, workspaceRoot),
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
}

contextBridge.exposeInMainWorld('electronAPI', electronAPI)
