import { EventEmitter } from 'events'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: any[]) => any>(),
  showMessageBox: vi.fn(),
  appearanceListener: null as ((snapshot: any) => void) | null,
  appearanceError: null as Error | null,
  appearanceSnapshot: vi.fn(() => ({ revision: 0, theme: 'dark', readingPreferences: {} })),
}))
vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: (...args: any[]) => any) =>
      mocks.handlers.set(channel, handler),
  },
  dialog: { showMessageBox: mocks.showMessageBox },
}))
vi.mock('../../src/main/store', () => ({
  default: { get: (key: string) => (key === 'theme' ? 'dark' : {}) },
}))
vi.mock('../../src/main/appearance', () => ({
  appearance: {
    snapshot: () => mocks.appearanceSnapshot(),
    current: () => ({ revision: 0, theme: 'dark', readingPreferences: {} }),
    subscribe: (listener: (snapshot: any) => void) => {
      mocks.appearanceListener = listener
    },
    update: (update: any) => {
      if (mocks.appearanceError) throw mocks.appearanceError
      const snapshot = { revision: 1, theme: update.theme ?? 'dark', readingPreferences: {} }
      mocks.appearanceListener?.(snapshot)
      return snapshot
    },
  },
}))
vi.mock('../../src/main/native-theme', () => ({ syncNativeChromeTheme: vi.fn() }))
vi.mock('../../src/main/logger', () => ({ default: { error: vi.fn() } }))

class FakeWindow extends EventEmitter {
  destroyed = false
  webContents: { id: number; send: ReturnType<typeof vi.fn> }
  show = vi.fn()
  focus = vi.fn()
  constructor(id: number) {
    super()
    this.webContents = { id, send: vi.fn() }
  }
  isDestroyed() {
    return this.destroyed
  }
  isMinimized() {
    return false
  }
  destroy() {
    this.destroyed = true
    this.emit('closed')
  }
}

describe('window coordinator', () => {
  let coordinator: import('../../src/main/window-coordinator').WindowCoordinator
  let windows: FakeWindow[]
  const invoke = (channel: string, id: number, payload?: unknown) =>
    mocks.handlers.get(channel)!({ sender: { id } }, payload)

  beforeEach(async () => {
    mocks.handlers.clear()
    mocks.appearanceError = null
    mocks.appearanceSnapshot
      .mockReset()
      .mockReturnValue({ revision: 0, theme: 'dark', readingPreferences: {} })
    mocks.showMessageBox.mockReset()
    windows = []
    const { WindowCoordinator } = await import('../../src/main/window-coordinator')
    coordinator = new WindowCoordinator((root) => {
      const window = new FakeWindow(windows.length + 1)
      windows.push(window)
      coordinator.register(window as any, root)
      return window as any
    })
    coordinator.registerHandlers()
  })

  it('delivers reserved files only after the target window is ready and focuses the owner on repeat', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'flux-window-'))
    const filePath = path.join(directory, 'note.md')
    fs.writeFileSync(filePath, 'note')
    try {
      expect((await coordinator.create({ workspaceRoot: null, filePath })).success).toBe(true)
      expect(windows[0].webContents.send).not.toHaveBeenCalled()
      await invoke('window:ready', 1)
      expect(windows[0].webContents.send.mock.calls.map((call) => call[0])).toEqual([
        'window:initialize',
        'document:open-reserved',
      ])
      const credential = windows[0].webContents.send.mock.calls[1][1]
      expect(await invoke('document:commit', 1, credential)).toMatchObject({ success: true })
      expect(await coordinator.create({ workspaceRoot: null, filePath })).toMatchObject({
        data: { created: false, focused: true },
      })
      expect(windows[1].destroyed).toBe(true)
      expect(windows[0].webContents.send).toHaveBeenLastCalledWith('app:open-file', filePath)
    } finally {
      fs.rmSync(directory, { recursive: true, force: true })
    }
  })

  it('uses the responding source workspace and rejects another sender snapshot', async () => {
    await coordinator.create({ workspaceRoot: null })
    await invoke('window:ready', 1)
    const creating = invoke('window:create', 1, { workspaceRoot: null })
    const query = windows[0].webContents.send.mock.calls.find(
      (call) => call[0] === 'window:workspace-query',
    )![1]
    expect(
      await invoke('window:workspace-snapshot', 2, {
        requestId: query.requestId,
        workspaceRoot: null,
        revision: 0,
      }),
    ).toMatchObject({ success: false })
    expect(
      await invoke('window:workspace-snapshot', 1, {
        requestId: query.requestId,
        workspaceRoot: null,
        revision: 0,
      }),
    ).toMatchObject({ success: true })
    expect(await creating).toMatchObject({ success: true, data: { created: true } })
    expect(windows).toHaveLength(2)
  })

  it('releases a pending reservation if its target window is destroyed', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'flux-window-close-'))
    const filePath = path.join(directory, 'note.md')
    fs.writeFileSync(filePath, 'note')
    try {
      expect((await coordinator.create({ workspaceRoot: null, filePath })).success).toBe(true)
      windows[0].destroy()
      expect(await coordinator.create({ workspaceRoot: null, filePath })).toMatchObject({
        success: true,
        data: { created: true },
      })
      await invoke('window:ready', 2)
      expect(windows[1].webContents.send.mock.calls.map((call) => call[0])).toEqual([
        'window:initialize',
        'document:open-reserved',
      ])
    } finally {
      fs.rmSync(directory, { recursive: true, force: true })
    }
  })

  it('refuses a pending document commit during application shutdown', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'flux-window-quit-'))
    const filePath = path.join(directory, 'note.md')
    fs.writeFileSync(filePath, 'note')
    try {
      await coordinator.create({ workspaceRoot: null, filePath })
      await invoke('window:ready', 1)
      const credential = windows[0].webContents.send.mock.calls[1][1]
      coordinator.setShuttingDown(true)
      expect(await invoke('document:commit', 1, credential)).toMatchObject({
        success: false,
        code: 'CANCELLED',
      })
      coordinator.setShuttingDown(false)
      expect(await invoke('document:commit', 1, credential)).toMatchObject({ success: true })
    } finally {
      fs.rmSync(directory, { recursive: true, force: true })
    }
  })

  it('broadcasts appearance updates only to ready windows', async () => {
    await coordinator.create({ workspaceRoot: null })
    await coordinator.create({ workspaceRoot: null })
    await invoke('window:ready', 1)
    expect(await invoke('appearance:update', 1, { theme: 'light' })).toMatchObject({
      success: true,
      data: { revision: 1 },
    })
    expect(windows[0].webContents.send).toHaveBeenLastCalledWith(
      'appearance:changed',
      expect.objectContaining({ revision: 1, theme: 'light' }),
    )
    expect(windows[1].webContents.send).not.toHaveBeenCalled()
    expect(await invoke('appearance:update', 2, { theme: 'light' })).toMatchObject({
      success: false,
      code: 'INVALID_DATA',
    })
  })

  it('reports persistence TypeError as an IO failure', async () => {
    await coordinator.create({ workspaceRoot: null })
    await invoke('window:ready', 1)
    mocks.appearanceError = new TypeError('storage failed')
    expect(await invoke('appearance:update', 1, { theme: 'light' })).toMatchObject({
      success: false,
      code: 'IO_ERROR',
    })
  })

  it('deduplicates ready requests while a failed migration awaits a decision', async () => {
    await coordinator.create({ workspaceRoot: null })
    mocks.appearanceSnapshot.mockImplementationOnce(() => {
      throw new Error('disk failed')
    })
    let decide: ((value: { response: number }) => void) | undefined
    mocks.showMessageBox.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          decide = resolve
        }),
    )
    const first = invoke('window:ready', 1)
    const second = invoke('window:ready', 1)
    expect(mocks.showMessageBox).toHaveBeenCalledOnce()
    decide?.({ response: 1 })
    expect(await first).toMatchObject({ success: true })
    expect(await second).toMatchObject({ success: true })
    expect(
      windows[0].webContents.send.mock.calls.filter((call) => call[0] === 'window:initialize'),
    ).toHaveLength(1)
  })

  it('retries migration on request before delivering the initialization snapshot', async () => {
    await coordinator.create({ workspaceRoot: null })
    mocks.appearanceSnapshot.mockImplementationOnce(() => {
      throw new Error('disk failed')
    })
    mocks.showMessageBox.mockResolvedValueOnce({ response: 0 })
    expect(await invoke('window:ready', 1)).toMatchObject({ success: true })
    expect(mocks.appearanceSnapshot).toHaveBeenCalledTimes(2)
    expect(windows[0].webContents.send).toHaveBeenCalledWith(
      'window:initialize',
      expect.objectContaining({ revision: 0 }),
    )
  })

  it('transfers a failed pending reservation to a waiting window without duplicate ownership', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'flux-window-compete-'))
    const filePath = path.join(directory, 'note.md')
    fs.writeFileSync(filePath, 'note')
    try {
      await coordinator.create({ workspaceRoot: null, filePath })
      const waiting = coordinator.create({ workspaceRoot: null, filePath })
      await vi.waitFor(() => expect(windows).toHaveLength(2))
      let settled = false
      void waiting.then(() => {
        settled = true
      })
      await new Promise((resolve) => setTimeout(resolve, 30))
      expect(settled).toBe(false)
      await invoke('window:ready', 1)
      const firstCredential = windows[0].webContents.send.mock.calls.find(
        (call) => call[0] === 'document:open-reserved',
      )![1]
      expect(await invoke('document:release', 1, firstCredential)).toMatchObject({ success: true })
      expect(await waiting).toMatchObject({ success: true, data: { created: true } })
      await invoke('window:ready', 2)
      const nextCredential = windows[1].webContents.send.mock.calls.find(
        (call) => call[0] === 'document:open-reserved',
      )![1]
      expect(nextCredential.reservationId).not.toBe(firstCredential.reservationId)
      expect(await invoke('document:commit', 2, nextCredential)).toMatchObject({ success: true })
      expect(await invoke('document:release', 1, firstCredential)).toMatchObject({ success: true })
      expect(await coordinator.create({ workspaceRoot: null, filePath })).toMatchObject({
        data: { created: false, focused: true },
      })
      expect(windows[1].webContents.send).toHaveBeenLastCalledWith('app:open-file', filePath)
    } finally {
      fs.rmSync(directory, { recursive: true, force: true })
    }
  })

  it('inherits the queried workspace instead of an older reported cache', async () => {
    await coordinator.create({ workspaceRoot: null })
    await invoke('window:ready', 1)
    const staleRoot = path.resolve('workspace-stale')
    const currentRoot = path.resolve('workspace-current')
    expect(
      await invoke('window:workspace-changed', 1, { workspaceRoot: staleRoot, revision: 1 }),
    ).toMatchObject({ data: { accepted: true } })
    const creating = invoke('window:create', 1, { workspaceRoot: staleRoot })
    const query = windows[0].webContents.send.mock.calls.find(
      (call) => call[0] === 'window:workspace-query',
    )![1]
    expect(
      await invoke('window:workspace-snapshot', 1, {
        requestId: query.requestId,
        workspaceRoot: currentRoot,
        revision: 2,
      }),
    ).toMatchObject({ success: true })
    expect(await creating).toMatchObject({ success: true })
    await invoke('window:ready', 2)
    expect(windows[1].webContents.send).toHaveBeenCalledWith(
      'window:initialize',
      expect.objectContaining({ workspaceRoot: currentRoot }),
    )
  })

  it('does not create a window from stale cache when the source query times out', async () => {
    await coordinator.create({ workspaceRoot: null })
    await invoke('window:ready', 1)
    const staleRoot = path.resolve('workspace-stale')
    await invoke('window:workspace-changed', 1, { workspaceRoot: staleRoot, revision: 1 })
    vi.useFakeTimers()
    try {
      const creating = invoke('window:create', 1, { workspaceRoot: staleRoot })
      await vi.advanceTimersByTimeAsync(5000)
      expect(await creating).toMatchObject({ success: false, code: 'TIMEOUT' })
      expect(windows).toHaveLength(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('retains the existing IO error when the workspace source closes during a query', async () => {
    await coordinator.create({ workspaceRoot: null })
    await invoke('window:ready', 1)
    const creating = invoke('window:create', 1, { workspaceRoot: null })
    windows[0].destroy()
    expect(await creating).toMatchObject({ success: false, code: 'IO_ERROR' })
    expect(windows).toHaveLength(1)
  })
})
