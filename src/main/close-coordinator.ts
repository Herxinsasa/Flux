import { randomUUID } from 'crypto'
import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import { IPC_CHANNELS } from '../shared/ipc-channels'
import type { CloseResult } from '../shared/types'

const FREEZE_TIMEOUT_MS = 5000

type CloseTransaction = {
  id: string
  scope: 'window' | 'application'
  targets: BrowserWindow[]
  frozen: Set<number>
  checking: number | null
  next: number
  timer: ReturnType<typeof setTimeout> | null
}

export class CloseCoordinator {
  private transaction: CloseTransaction | null = null
  private readonly allowed = new Set<number>()
  private quitting = false

  constructor(private readonly setShuttingDown: (value: boolean) => void) {}

  registerHandlers(): void {
    ipcMain.on(IPC_CHANNELS.APP_CLOSE_RESULT, (event, result: CloseResult) => {
      const tx = this.transaction
      if (
        !tx ||
        !result ||
        result.requestId !== tx.id ||
        !tx.targets.some((window) => window.webContents.id === event.sender.id)
      )
        return
      if (result.result === 'cancelled' || result.result === 'failed') {
        if (tx.checking !== null ? tx.checking !== event.sender.id : tx.frozen.has(event.sender.id))
          return
        this.cancel()
        return
      }
      if (result.result === 'frozen' && tx.scope === 'application' && tx.checking === null) {
        tx.frozen.add(event.sender.id)
        if (tx.frozen.size === tx.targets.length) {
          if (tx.timer) clearTimeout(tx.timer)
          tx.timer = null
          this.checkNext(tx)
        }
        return
      }
      if (result.result === 'approved' && tx.checking === event.sender.id) this.checkNext(tx)
    })
    app.on('before-quit', (event) => {
      if (this.quitting) return
      event.preventDefault()
      if (!this.transaction) this.begin(BrowserWindow.getAllWindows(), 'application')
    })
  }

  register(window: BrowserWindow): void {
    const id = window.webContents.id
    window.on('close', (event) => {
      if (this.allowed.has(id) || this.quitting || window.webContents.isDestroyed()) return
      event.preventDefault()
      if (!this.transaction) this.begin([window], 'window')
    })
    window.on('closed', () => {
      this.allowed.delete(id)
      if (this.transaction?.targets.includes(window)) this.cancel()
    })
  }

  private begin(targets: BrowserWindow[], scope: 'window' | 'application'): void {
    if (targets.length === 0) {
      this.quitting = true
      app.quit()
      return
    }
    const tx: CloseTransaction = {
      id: randomUUID(),
      scope,
      targets,
      frozen: new Set(),
      checking: null,
      next: 0,
      timer: null,
    }
    this.transaction = tx
    if (scope === 'application') {
      this.setShuttingDown(true)
      for (const window of targets)
        window.webContents.send(IPC_CHANNELS.APP_CLOSE_REQUEST, {
          requestId: tx.id,
          scope,
          phase: 'freeze',
        })
      tx.timer = setTimeout(() => {
        if (this.transaction !== tx) return
        this.cancel()
        void dialog.showMessageBox({ type: 'warning', message: '窗口未及时响应，请重试退出。' })
      }, FREEZE_TIMEOUT_MS)
    } else {
      this.checkNext(tx)
    }
  }

  private checkNext(tx: CloseTransaction): void {
    if (this.transaction !== tx) return
    if (tx.next >= tx.targets.length) {
      this.transaction = null
      if (tx.scope === 'application') {
        this.quitting = true
        app.quit()
      } else {
        const window = tx.targets[0]
        this.allowed.add(window.webContents.id)
        window.close()
      }
      return
    }
    const target = tx.targets[tx.next++]
    if (target.isDestroyed()) {
      this.cancel()
      return
    }
    tx.checking = target.webContents.id
    target.webContents.send(IPC_CHANNELS.APP_CLOSE_REQUEST, {
      requestId: tx.id,
      scope: tx.scope,
      phase: 'check',
    })
  }

  private cancel(): void {
    const tx = this.transaction
    if (!tx) return
    this.transaction = null
    if (tx.timer) clearTimeout(tx.timer)
    for (const target of tx.targets) {
      if (!target.isDestroyed())
        target.webContents.send(IPC_CHANNELS.APP_CLOSE_CANCELLED, { requestId: tx.id })
    }
    if (tx.scope === 'application') this.setShuttingDown(false)
  }
}
