/// <reference types="vite/client" />

declare global {
  interface Window {
    electronAPI: {
      app: {
        getVersion: () => Promise<{ success: boolean; data?: { version: string }; error?: string }>
      }
      file: {
        open: () => Promise<unknown>
        create: () => Promise<unknown>
        openFolder: () => Promise<unknown>
        listWorkspaceFiles: (root: string) => Promise<unknown>
        read: (filePath: string) => Promise<unknown>
        readStream: (filePath: string, callback: (chunk: string | null) => void) => () => void
        getInfo: (filePath: string) => Promise<unknown>
        write: (filePath: string, content: string) => Promise<{ success: boolean; error?: string }>
        getFilePath: (file: File) => string
      }
      settings: {
        save: (settings: Record<string, unknown>) => Promise<unknown>
        get: () => Promise<unknown>
        testConnection: (config: {
          id: string
          name: string
          type: string
          apiKey: string
          baseUrl?: string
          model: string
        }) => Promise<{ success: boolean; error?: string }>
        workspaceVerify: (
          workspaceRoot: string,
        ) => Promise<{ success: boolean; skipped?: boolean; error?: string }>
      }
      agent: {
        send: (message: string, context?: unknown) => Promise<unknown>
        cancel: () => Promise<unknown>
        onStream: (callback: (token: string) => void) => () => void
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
