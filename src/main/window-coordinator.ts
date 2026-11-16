import { randomUUID } from 'crypto'
import { BrowserWindow, dialog, ipcMain } from 'electron'
import path from 'path'
import { IPC_CHANNELS } from '../shared/ipc-channels'
import type {
  DocumentCredential,
  DocumentReservationRequest,
  IpcResponse,
  WindowCreateRequest,
} from '../shared/types'
import { DocumentOwnership } from './services/document-ownership'
import { appearance } from './appearance'
import { AppearanceValidationError } from './services/appearance-service'
import { syncNativeChromeTheme } from './native-theme'
import log from './logger'
import type { AppearanceUpdate } from '../shared/types'

type WindowState = {
  window: BrowserWindow
  workspaceRoot: string | null
  workspaceRevision: number
  ready: boolean
  readyPending: Promise<IpcResponse<{ ready: true }>> | null
  pending: DocumentCredential[]
  abort: AbortController
}

class WorkspaceQueryTimeoutError extends Error {}

export class WindowCoordinator {
  private readonly ownership = new DocumentOwnership()
  private readonly states = new Map<number, WindowState>()
  private readonly recent: number[] = []
  private shuttingDown = false
  private readonly workspaceQueries = new Map<
    string,
    {
      ownerId: number
      resolve: (root: string | null) => void
      reject: (error: Error) => void
      timer: ReturnType<typeof setTimeout>
    }
  >()
  private readonly readyWaiters = new Map<number, Set<() => void>>()

  constructor(private readonly makeWindow: (workspaceRoot: string | null) => BrowserWindow) {}

  register(window: BrowserWindow, workspaceRoot: string | null): void {
    const id = window.webContents.id
    const state: WindowState = {
      window,
      workspaceRoot,
      workspaceRevision: 0,
      ready: false,
      readyPending: null,
      pending: [],
      abort: new AbortController(),
    }
    this.states.set(id, state)
    window.on('focus', () => {
      const index = this.recent.indexOf(id)
      if (index >= 0) this.recent.splice(index, 1)
      this.recent.unshift(id)
    })
    window.on('closed', () => {
      state.abort.abort()
      for (const [requestId, query] of this.workspaceQueries) {
        if (query.ownerId !== id) continue
        clearTimeout(query.timer)
        this.workspaceQueries.delete(requestId)
        query.reject(new Error('Workspace source closed'))
      }
      this.ownership.releaseOwner(id)
      this.states.delete(id)
      const index = this.recent.indexOf(id)
      if (index >= 0) this.recent.splice(index, 1)
    })
  }

  private latestWindow(): WindowState | undefined {
    for (const id of this.recent) {
      const state = this.states.get(id)
      if (state && state.ready && !state.window.isDestroyed()) return state
    }
    return undefined
  }

  private queryWorkspace(state: WindowState): Promise<string | null> {
    return new Promise((resolve, reject) => {
      const requestId = randomUUID()
      const timer = setTimeout(() => {
        this.workspaceQueries.delete(requestId)
        reject(new WorkspaceQueryTimeoutError('Workspace query timed out'))
      }, 5000)
      this.workspaceQueries.set(requestId, {
        ownerId: state.window.webContents.id,
        resolve,
        reject,
        timer,
      })
      state.window.webContents.send(IPC_CHANNELS.WINDOW_WORKSPACE_QUERY, { requestId })
    })
  }

  private async sourceForLaunch(): Promise<WindowState | undefined> {
    const ready =
      this.latestWindow() ??
      [...this.states.values()].find((state) => state.ready && !state.window.isDestroyed())
    if (ready) return ready
    const pending = [...this.states.values()].find((state) => !state.window.isDestroyed())
    if (!pending) return undefined
    await new Promise<void>((resolve, reject) => {
      const id = pending.window.webContents.id
      const finish = () => {
        cleanup()
        resolve()
      }
      const abort = () => {
        cleanup()
        reject(new Error('Workspace source closed'))
      }
      const timeout = setTimeout(() => {
        cleanup()
        reject(new Error('Workspace source was not ready'))
      }, 5000)
      const cleanup = () => {
        clearTimeout(timeout)
        pending.abort.signal.removeEventListener('abort', abort)
        this.readyWaiters.get(id)?.delete(finish)
      }
      const waiters = this.readyWaiters.get(id) ?? new Set<() => void>()
      waiters.add(finish)
      this.readyWaiters.set(id, waiters)
      pending.abort.signal.addEventListener('abort', abort, { once: true })
      if (pending.ready) finish()
      else if (pending.abort.signal.aborted) abort()
    })
    return pending
  }

  async createFromLatest(filePath?: string): Promise<void> {
    try {
      const source = await this.sourceForLaunch()
      const workspaceRoot = source ? await this.queryWorkspace(source) : null
      const result = await this.create({ workspaceRoot, ...(filePath ? { filePath } : {}) })
      if (!result.success) throw new Error(result.error ?? 'Window creation failed')
    } catch (error) {
      await dialog.showMessageBox({
        type: 'error',
        message: '无法获取来源工作区或创建窗口',
        detail: String(error),
      })
    }
  }

  setShuttingDown(value: boolean): void {
    this.shuttingDown = value
  }

  hasReservation(ownerId: number, credential: DocumentCredential): boolean {
    return (
      !this.shuttingDown &&
      this.states.has(ownerId) &&
      this.ownership.hasReservation(ownerId, credential.filePath, credential.reservationId)
    )
  }

  private focus(ownerId: number, filePath: string): void {
    const owner = this.states.get(ownerId)?.window
    if (!owner || owner.isDestroyed()) throw new Error('Document owner is unavailable')
    if (owner.isMinimized()) owner.restore()
    owner.focus()
    owner.webContents.send(IPC_CHANNELS.APP_OPEN_FILE, filePath)
  }

  private error(error: unknown): IpcResponse {
    const code = (error as NodeJS.ErrnoException)?.code
    if (code === 'ENOENT' || code === 'ENOTDIR')
      return { success: false, code: 'NOT_FOUND', error: String(error) }
    if (code === 'EACCES' || code === 'EPERM')
      return { success: false, code: 'PERMISSION_DENIED', error: String(error) }
    if ((error as Error)?.name === 'AbortError')
      return { success: false, code: 'CANCELLED', error: String(error) }
    return { success: false, code: 'IO_ERROR', error: String(error) }
  }

  async create(
    request: WindowCreateRequest,
  ): Promise<IpcResponse<{ created: boolean; focused?: boolean }>> {
    if (this.shuttingDown)
      return { success: false, code: 'CANCELLED', error: 'Application is closing' }
    if (
      !request ||
      (request.workspaceRoot !== null &&
        (typeof request.workspaceRoot !== 'string' || !path.isAbsolute(request.workspaceRoot))) ||
      (request.filePath !== undefined &&
        (typeof request.filePath !== 'string' || !path.isAbsolute(request.filePath)))
    ) {
      return { success: false, code: 'INVALID_DATA', error: 'Invalid window request' }
    }
    let target: BrowserWindow | undefined
    try {
      target = this.makeWindow(request.workspaceRoot)
      if (!request.filePath) {
        target.show()
        return { success: true, data: { created: true } }
      }
      const state = this.states.get(target.webContents.id)
      if (!state) throw new Error('Window was not registered')
      const result = await this.ownership.reserve(
        target.webContents.id,
        request.filePath,
        'open',
        state.abort.signal,
      )
      if (this.shuttingDown) {
        target.destroy()
        return { success: false, code: 'CANCELLED', error: 'Application is closing' }
      }
      if (result.status === 'timeout') {
        target.destroy()
        return { success: false, code: 'TIMEOUT', error: 'Document reservation timed out' }
      }
      if (result.status === 'focused') {
        target.destroy()
        this.focus(result.ownerId, result.filePath)
        return { success: true, data: { created: false, focused: true } }
      }
      state.pending.push({ filePath: result.filePath, reservationId: result.reservationId })
      this.flush(state)
      target.show()
      return { success: true, data: { created: true } }
    } catch (error) {
      if (target && !target.isDestroyed()) target.destroy()
      return this.error(error) as IpcResponse<{ created: boolean; focused?: boolean }>
    }
  }

  private flush(state: WindowState): void {
    if (!state.ready || state.window.isDestroyed()) return
    for (const item of state.pending.splice(0))
      state.window.webContents.send(IPC_CHANNELS.DOCUMENT_OPEN_RESERVED, item)
  }

  registerHandlers(): void {
    const sender = (contents: Electron.WebContents) => this.states.get(contents.id)
    appearance.subscribe((snapshot) => {
      try {
        syncNativeChromeTheme()
      } catch (error) {
        log.error(`native appearance update failed, reason=${String(error)}`)
      }
      for (const state of this.states.values()) {
        if (!state.ready || state.window.isDestroyed()) continue
        try {
          state.window.webContents.send(IPC_CHANNELS.APPEARANCE_CHANGED, snapshot)
        } catch (error) {
          log.error(`appearance notification failed, reason=${String(error)}`)
        }
      }
    })
    ipcMain.handle(IPC_CHANNELS.APPEARANCE_UPDATE, (event, update: AppearanceUpdate) => {
      const state = sender(event.sender)
      if (!state?.ready) return { success: false, code: 'INVALID_DATA', error: 'Invalid sender' }
      try {
        const snapshot = appearance.update(update)
        return { success: true, data: { revision: snapshot.revision } }
      } catch (error) {
        return {
          success: false,
          code: error instanceof AppearanceValidationError ? 'INVALID_DATA' : 'IO_ERROR',
          error: String(error),
        }
      }
    })
    ipcMain.handle(IPC_CHANNELS.WINDOW_CREATE, async (event, request: WindowCreateRequest) => {
      const state = sender(event.sender)
      if (!state || !state.ready || !request)
        return { success: false, code: 'INVALID_DATA', error: 'Invalid sender' }
      try {
        const workspaceRoot = await this.queryWorkspace(state)
        if (state.window.isDestroyed())
          return { success: false, code: 'CANCELLED', error: 'Workspace source closed' }
        return this.create({ ...request, workspaceRoot })
      } catch (error) {
        return {
          success: false,
          code: error instanceof WorkspaceQueryTimeoutError ? 'TIMEOUT' : 'IO_ERROR',
          error: `无法获取来源工作区: ${String(error)}`,
        }
      }
    })
    const validRoot = (root: unknown): root is string | null =>
      root === null || (typeof root === 'string' && path.isAbsolute(root))
    ipcMain.handle(
      IPC_CHANNELS.WINDOW_WORKSPACE_CHANGED,
      (event, payload: { workspaceRoot: string | null; revision: number }) => {
        const state = sender(event.sender)
        if (
          !state ||
          !state.ready ||
          !payload ||
          !validRoot(payload.workspaceRoot) ||
          !Number.isSafeInteger(payload.revision) ||
          payload.revision < 1
        )
          return { success: false, code: 'INVALID_DATA', error: 'Invalid workspace update' }
        const accepted = payload.revision > state.workspaceRevision
        if (accepted) {
          state.workspaceRevision = payload.revision
          state.workspaceRoot = payload.workspaceRoot
        }
        return { success: true, data: { accepted } }
      },
    )
    ipcMain.handle(
      IPC_CHANNELS.WINDOW_WORKSPACE_SNAPSHOT,
      (event, payload: { requestId: string; workspaceRoot: string | null; revision: number }) => {
        const state = sender(event.sender)
        if (
          !state ||
          !payload ||
          typeof payload.requestId !== 'string' ||
          !validRoot(payload.workspaceRoot) ||
          !Number.isSafeInteger(payload.revision) ||
          payload.revision < 0
        )
          return { success: false, code: 'INVALID_DATA', error: 'Invalid workspace snapshot' }
        const query = this.workspaceQueries.get(payload.requestId)
        if (!query || query.ownerId !== event.sender.id)
          return { success: false, code: 'CANCELLED', error: 'Workspace query expired' }
        clearTimeout(query.timer)
        this.workspaceQueries.delete(payload.requestId)
        query.resolve(payload.workspaceRoot)
        return { success: true, data: { accepted: true } }
      },
    )
    ipcMain.handle(IPC_CHANNELS.WINDOW_READY, async (event) => {
      const state = sender(event.sender)
      if (!state) return { success: false, code: 'INVALID_DATA', error: 'Invalid sender' }
      if (state.ready) return { success: true, data: { ready: true } }
      if (state.readyPending) return state.readyPending
      state.readyPending = (async (): Promise<IpcResponse<{ ready: true }>> => {
        let snapshot
        while (true) {
          try {
            snapshot = appearance.snapshot()
            break
          } catch (error) {
            log.error(`appearance migration failed, reason=${String(error)}`)
            let choice
            try {
              choice = await dialog.showMessageBox(state.window, {
                type: 'warning',
                message: '无法更新代码字体设置，将保留原设置。',
                detail: '可以重试，或稍后再次尝试。',
                buttons: ['重试', '稍后'],
                defaultId: 0,
                cancelId: 1,
              })
            } catch (dialogError) {
              return { success: false, code: 'IO_ERROR', error: String(dialogError) }
            }
            if (state.window.isDestroyed())
              return { success: false, code: 'CANCELLED', error: 'Window closed' }
            if (choice.response === 0) continue
            try {
              snapshot = appearance.current()
              break
            } catch (readError) {
              return { success: false, code: 'IO_ERROR', error: String(readError) }
            }
          }
        }
        state.ready = true
        const waiters = this.readyWaiters.get(event.sender.id)
        this.readyWaiters.delete(event.sender.id)
        waiters?.forEach((finish) => finish())
        state.window.webContents.send(IPC_CHANNELS.WINDOW_INITIALIZE, {
          workspaceRoot: state.workspaceRoot,
          ...snapshot,
        })
        this.flush(state)
        return { success: true, data: { ready: true } }
      })()
      try {
        return await state.readyPending
      } finally {
        state.readyPending = null
      }
    })
    ipcMain.handle(
      IPC_CHANNELS.DOCUMENT_RESERVE,
      async (event, request: DocumentReservationRequest) => {
        const state = sender(event.sender)
        if (
          !state ||
          !request ||
          typeof request.filePath !== 'string' ||
          !path.isAbsolute(request.filePath) ||
          !['open', 'create'].includes(request.purpose)
        )
          return { success: false, code: 'INVALID_DATA', error: 'Invalid reservation request' }
        if (this.shuttingDown)
          return { success: false, code: 'CANCELLED', error: 'Application is closing' }
        try {
          const result = await this.ownership.reserve(
            event.sender.id,
            request.filePath,
            request.purpose,
            state.abort.signal,
          )
          if (result.status === 'timeout')
            return { success: false, code: 'TIMEOUT', error: 'Document reservation timed out' }
          if (result.status === 'focused') {
            this.focus(result.ownerId, result.filePath)
            return { success: true, data: { status: 'focused', filePath: result.filePath } }
          }
          return { success: true, data: result }
        } catch (error) {
          return this.error(error)
        }
      },
    )
    const credential = (
      event: Electron.IpcMainInvokeEvent,
      request: DocumentCredential,
      operation: 'commit' | 'release',
    ) => {
      if (operation === 'commit' && this.shuttingDown)
        return { success: false, code: 'CANCELLED', error: 'Application is closing' }
      if (
        !sender(event.sender) ||
        !request ||
        typeof request.filePath !== 'string' ||
        !path.isAbsolute(request.filePath) ||
        typeof request.reservationId !== 'string'
      )
        return { success: false, code: 'INVALID_DATA', error: 'Invalid document credential' }
      return this.ownership[operation](event.sender.id, request.filePath, request.reservationId)
        ? { success: true, data: { accepted: true } }
        : { success: false, code: 'CANCELLED', error: 'Document reservation is no longer valid' }
    }
    ipcMain.handle(IPC_CHANNELS.DOCUMENT_COMMIT, (event, request) =>
      credential(event, request, 'commit'),
    )
    ipcMain.handle(IPC_CHANNELS.DOCUMENT_RELEASE, (event, request) =>
      credential(event, request, 'release'),
    )
  }
}
