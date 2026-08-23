/// <reference types="vite/client" />

declare global {
  interface Window {
    electronAPI: {
      app: {
        getVersion: () => Promise<{ success: boolean; data?: { version: string }; error?: string }>
        onOpenFile: (callback: (filePath: string) => void) => () => void
        onCloseRequest: (callback: () => void) => () => void
        approveClose: () => void
      }
      recent: {
        list: () => Promise<{ success: boolean; data?: import('../../../shared/recent').RecentItemData[]; error?: string }>
        record: (itemPath: string, kind: 'file' | 'folder') => Promise<{ success: boolean; error?: string }>
        remove: (itemPath: string) => Promise<{ success: boolean; error?: string }>
      }
      review: {
        load: (request: import('../../../shared/review').ReviewLoadRequest) => Promise<import('../../../shared/types').IpcResponse<import('../../../shared/review').ReviewLoadResult>>
        save: (request: import('../../../shared/review').ReviewSaveRequest) => Promise<import('../../../shared/types').IpcResponse<import('../../../shared/review').ReviewSaveResult>>
        export: (request: import('../../../shared/review').ReviewExportRequest) => Promise<import('../../../shared/types').IpcResponse<import('../../../shared/review').ReviewExportResult>>
      }
      attachment: {
        saveImage: (request: import('../../../shared/attachment-backup').SaveImageAttachmentRequest) => Promise<import('../../../shared/types').IpcResponse<import('../../../shared/attachment-backup').SaveImageAttachmentResult>>
      }
      backup: {
        create: (input: import('../../../shared/attachment-backup').BackupSnapshotInput) => Promise<import('../../../shared/types').IpcResponse<import('../../../shared/attachment-backup').BackupSnapshotSummary>>
        list: (sourcePath?: string) => Promise<import('../../../shared/types').IpcResponse<import('../../../shared/attachment-backup').BackupSnapshotSummary[]>>
        read: (snapshotId: string) => Promise<import('../../../shared/types').IpcResponse<import('../../../shared/attachment-backup').BackupSnapshotContent | null>>
        recoveries: (sourcePath?: string) => Promise<import('../../../shared/types').IpcResponse<import('../../../shared/attachment-backup').BackupRecoveryCandidate[]>>
        discard: (snapshotId: string) => Promise<import('../../../shared/types').IpcResponse<{ discarded: boolean }>>
        saveAs: (request: import('../../../shared/attachment-backup').SaveBackupAsRequest) => Promise<import('../../../shared/types').IpcResponse<{ cancelled?: boolean; targetPath?: string }>>
      }
      file: {
        open: () => Promise<unknown>
        create: () => Promise<unknown>
        openFolder: (root?: string) => Promise<unknown>
        listWorkspaceFiles: (root: string) => Promise<unknown>
        scanWorkspace: (root: string) => Promise<{ success: boolean; data?: import('../../../shared/types').TaskStartData; error?: string }>
        cancelWorkspaceScan: (taskId: string) => Promise<{ success: boolean; data?: { cancelled: boolean }; error?: string }>
        onWorkspaceScan: (callback: (event: import('../../../shared/types').WorkspaceScanEvent) => void) => () => void
        read: (filePath: string) => Promise<unknown>
        readText: (filePath: string) => Promise<{
          success: boolean
          data?: import('../../../shared/types').TextDocumentSnapshot
          error?: string
          code?: import('../../../shared/types').FluxErrorCode
        }>
        readStream: (filePath: string, callback: (chunk: string | null) => void) => () => void
        getInfo: (filePath: string) => Promise<unknown>
        write: (filePath: string, content: string) => Promise<{ success: boolean; error?: string }>
        saveText: (
          request: import('../../../shared/types').SaveTextRequest,
        ) => Promise<{
          success: boolean
          data?: import('../../../shared/types').SaveTextResult
          error?: string
          code?: import('../../../shared/types').FluxErrorCode
        }>
        getFilePath: (file: File) => string
      }
      settings: {
        save: (settings: Record<string, unknown>) => Promise<unknown>
        get: () => Promise<{
          success: boolean
          data?: { onboardingCompleted?: boolean; [key: string]: unknown }
          error?: string
        }>
        testConnection: (config: {
          id: string
          name: string
          type: string
          apiKey: string
          baseUrl?: string
          model: string
        }) => Promise<{ success: boolean; error?: string }>
        listModels: (config: {
          presetKey: 'anthropic' | 'openai' | 'deepseek' | 'kimi' | 'glm' | 'qwen' | 'custom'
          apiKey: string
          type: 'anthropic' | 'anthropic_compat' | 'openai_compat'
          baseUrl?: string
        }) => Promise<{ success: boolean; data?: { models: string[] }; error?: string }>
        workspaceVerify: (
          workspaceRoot: string,
        ) => Promise<{ success: boolean; skipped?: boolean; error?: string }>
      }
      agent: {
        send: (message: string, context?: unknown) => Promise<unknown>
        cancel: () => Promise<unknown>
        onStream: (callback: (token: string) => void) => () => void
      }
      aiAction: {
        run: (request: import('../../../shared/ai-action').AiActionRequest) => Promise<import('../../../shared/types').IpcResponse<import('../../../shared/ai-action').AiActionRunResult>>
        cancel: (sourcePath: string, requestId: string) => Promise<import('../../../shared/types').IpcResponse<{ cancelled: boolean }>>
      }
      skill: {
        import: () => Promise<unknown>
        importFolder: () => Promise<unknown>
        list: () => Promise<unknown>
        get: (name: string) => Promise<unknown>
        save: (skill: unknown) => Promise<unknown>
        toggle: (skillId: string, enabled: boolean) => Promise<unknown>
        delete: (name: string) => Promise<unknown>
      }
      editor: {
        jumpToLine: (line: number, filePath?: string) => Promise<unknown>
        previewChange: (change: unknown) => Promise<unknown>
        applyChange: (changeId: string) => Promise<unknown>
        rejectChange: (changeId: string) => Promise<unknown>
        applyTransaction: (transactionId: string) => Promise<unknown>
        rejectTransaction: (transactionId: string) => Promise<unknown>
        onChangeApplied: (callback: (payload: {
          changeId: string
          transactionId?: string
          filePath: string
          content: string
          startLine: number
          endLine: number
          changed: boolean
        }) => void) => () => void
      }
      export: {
        report: (content: string, defaultName: string) => Promise<{ success: boolean; data?: string | null; error?: string }>
      }
      log: {
        getIndex: (filePath: string) => Promise<{ success: boolean; data?: import('../../../shared/types').LogIndexPayload; error?: string }>
        index: (filePath: string) => Promise<{ success: boolean; data?: import('../../../shared/types').TaskStartData; error?: string }>
        cancelIndex: (taskId: string) => Promise<{ success: boolean; data?: { cancelled: boolean }; error?: string }>
        onIndex: (callback: (event: import('../../../shared/types').LogIndexTaskEvent) => void) => () => void
        readLines: (
          filePath: string,
          offset: number,
          limit: number,
        ) => Promise<{ success: boolean; data?: import('../../../shared/types').LogReadLinesPayload; error?: string }>
        evictIndex: (filePath: string) => Promise<{ success: boolean; error?: string }>
      }
      workspace: {
        readSession: (workspaceRoot: string) => Promise<{ success: boolean; data?: import('../../../shared/types').WorkspaceSessionPayload; error?: string }>
        writeSession: (
          workspaceRoot: string,
          payload: import('../../../shared/types').WorkspaceSessionPayload,
        ) => Promise<{ success: boolean; error?: string }>
        session: {
          create: (input: unknown) => Promise<unknown>
          list: (workspaceRoot: string) => Promise<unknown>
          load: (workspaceRoot: string, sessionId: string) => Promise<unknown>
          append: (input: unknown) => Promise<unknown>
          checkpoint: (input: unknown) => Promise<unknown>
          usage: () => Promise<unknown>
          cleanup: (options: unknown) => Promise<unknown>
          clear: (protectedSessionIds?: string[]) => Promise<unknown>
        }
      }
      media: {
        toLocalUrl: (absolutePath: string) => string
      }
      shell: {
        openExternal: (url: string) => Promise<{ success: boolean; error?: string }>
      }
    }
  }
}

// Electron window controls — WebkitAppRegion is non-standard but required for frameless windows
import 'react'

declare module 'react' {
  interface CSSProperties {
    WebkitAppRegion?: 'drag' | 'no-drag' | string
  }
}

export {}
