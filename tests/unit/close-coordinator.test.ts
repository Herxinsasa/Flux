import { EventEmitter } from 'events'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const electron = vi.hoisted(() => ({
  app: null as any,
  ipcMain: null as any,
  windows: [] as any[],
  showMessageBox: vi.fn(),
}))
vi.mock('electron', () => ({
  app: electron.app,
  ipcMain: electron.ipcMain,
  BrowserWindow: { getAllWindows: () => electron.windows },
  dialog: { showMessageBox: electron.showMessageBox },
}))

class FakeWindow extends EventEmitter {
  destroyed = false
  webContents: { id: number; send: ReturnType<typeof vi.fn>; isDestroyed: () => boolean }
  constructor(id: number) {
    super()
    this.webContents = { id, send: vi.fn(), isDestroyed: () => this.destroyed }
  }
  isDestroyed() {
    return this.destroyed
  }
  close() {
    let prevented = false
    this.emit('close', {
      preventDefault: () => {
        prevented = true
      },
    })
    if (!prevented) {
      this.destroyed = true
      this.emit('closed')
    }
  }
}

describe('close coordinator', () => {
  let coordinator: import('../../src/main/close-coordinator').CloseCoordinator
  let first: FakeWindow
  let second: FakeWindow
  let setShuttingDown: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    electron.app ??= new EventEmitter()
    electron.app.removeAllListeners()
    electron.app.quit = vi.fn()
    electron.ipcMain ??= new EventEmitter()
    electron.ipcMain.removeAllListeners()
    first = new FakeWindow(1)
    second = new FakeWindow(2)
    electron.windows = [first, second]
    setShuttingDown = vi.fn()
    const { CloseCoordinator } = await import('../../src/main/close-coordinator')
    coordinator = new CloseCoordinator(setShuttingDown)
    coordinator.registerHandlers()
    coordinator.register(first as any)
    coordinator.register(second as any)
  })

  it('freezes all windows before sequential checks and quits only after all approvals', () => {
    const event = { preventDefault: vi.fn() }
    electron.app.emit('before-quit', event)
    const firstFreeze = first.webContents.send.mock.calls[0][1]
    const secondFreeze = second.webContents.send.mock.calls[0][1]
    expect(firstFreeze).toMatchObject({ scope: 'application', phase: 'freeze' })
    expect(secondFreeze.requestId).toBe(firstFreeze.requestId)
    electron.ipcMain.emit(
      'app:close-result',
      { sender: { id: 2 } },
      { requestId: firstFreeze.requestId, result: 'frozen' },
    )
    expect(first.webContents.send).toHaveBeenCalledTimes(1)
    electron.ipcMain.emit(
      'app:close-result',
      { sender: { id: 1 } },
      { requestId: firstFreeze.requestId, result: 'frozen' },
    )
    expect(first.webContents.send.mock.calls[1][1]).toMatchObject({ phase: 'check' })
    electron.ipcMain.emit(
      'app:close-result',
      { sender: { id: 2 } },
      { requestId: firstFreeze.requestId, result: 'approved' },
    )
    expect(second.webContents.send).toHaveBeenCalledTimes(1)
    electron.ipcMain.emit(
      'app:close-result',
      { sender: { id: 1 } },
      { requestId: firstFreeze.requestId, result: 'approved' },
    )
    expect(second.webContents.send.mock.calls[1][1]).toMatchObject({ phase: 'check' })
    electron.ipcMain.emit(
      'app:close-result',
      { sender: { id: 2 } },
      { requestId: firstFreeze.requestId, result: 'approved' },
    )
    expect(electron.app.quit).toHaveBeenCalledOnce()
  })

  it('cancels and unfreezes both windows without accepting late approval', () => {
    electron.app.emit('before-quit', { preventDefault: vi.fn() })
    const requestId = first.webContents.send.mock.calls[0][1].requestId
    electron.ipcMain.emit(
      'app:close-result',
      { sender: { id: 1 } },
      { requestId, result: 'failed' },
    )
    expect(first.webContents.send).toHaveBeenLastCalledWith('app:close-cancelled', { requestId })
    expect(second.webContents.send).toHaveBeenLastCalledWith('app:close-cancelled', { requestId })
    expect(setShuttingDown).toHaveBeenLastCalledWith(false)
    electron.ipcMain.emit(
      'app:close-result',
      { sender: { id: 2 } },
      { requestId, result: 'approved' },
    )
    expect(electron.app.quit).not.toHaveBeenCalled()
  })

  it('closes only the approved sender window', () => {
    first.close()
    const requestId = first.webContents.send.mock.calls[0][1].requestId
    electron.ipcMain.emit(
      'app:close-result',
      { sender: { id: 2 } },
      { requestId, result: 'approved' },
    )
    expect(first.destroyed).toBe(false)
    electron.ipcMain.emit(
      'app:close-result',
      { sender: { id: 1 } },
      { requestId, result: 'approved' },
    )
    expect(first.destroyed).toBe(true)
    expect(second.destroyed).toBe(false)
  })

  it('aborts on freeze timeout and ignores a late frozen response', () => {
    vi.useFakeTimers()
    electron.app.emit('before-quit', { preventDefault: vi.fn() })
    const requestId = first.webContents.send.mock.calls[0][1].requestId
    vi.advanceTimersByTime(5000)
    expect(first.webContents.send).toHaveBeenLastCalledWith('app:close-cancelled', { requestId })
    electron.ipcMain.emit(
      'app:close-result',
      { sender: { id: 1 } },
      { requestId, result: 'frozen' },
    )
    expect(electron.app.quit).not.toHaveBeenCalled()
    vi.useRealTimers()
  })

  it('unfreezes a cancelled single-window close and ignores approval from the cancelled transaction', () => {
    first.close()
    const firstRequest = first.webContents.send.mock.calls[0][1].requestId
    electron.ipcMain.emit(
      'app:close-result',
      { sender: { id: 1 } },
      { requestId: firstRequest, result: 'cancelled' },
    )
    expect(first.webContents.send).toHaveBeenLastCalledWith('app:close-cancelled', {
      requestId: firstRequest,
    })
    first.close()
    const secondRequest = first.webContents.send.mock.calls.at(-1)![1].requestId
    expect(secondRequest).not.toBe(firstRequest)
    electron.ipcMain.emit(
      'app:close-result',
      { sender: { id: 1 } },
      { requestId: firstRequest, result: 'approved' },
    )
    expect(first.destroyed).toBe(false)
    electron.ipcMain.emit(
      'app:close-result',
      { sender: { id: 1 } },
      { requestId: secondRequest, result: 'approved' },
    )
    expect(first.destroyed).toBe(true)
    expect(second.destroyed).toBe(false)
  })
})
