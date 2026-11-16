import { EventEmitter } from 'events'
import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: any[]) => any>(),
  service: null as any,
}))
vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: (...args: any[]) => any) =>
      mocks.handlers.set(channel, handler),
  },
  dialog: { showMessageBox: vi.fn() },
}))
vi.mock('../../src/main/appearance', () => ({ appearance: mocks.service }))
vi.mock('../../src/main/native-theme', () => ({ syncNativeChromeTheme: vi.fn() }))
vi.mock('../../src/main/logger', () => ({ default: { error: vi.fn() } }))

class FakeWindow extends EventEmitter {
  webContents: { id: number; send: ReturnType<typeof vi.fn> }
  constructor(id: number) {
    super()
    this.webContents = { id, send: vi.fn() }
  }
  show() {}
  isDestroyed() {
    return false
  }
}

describe('shared appearance through window IPC', () => {
  it('merges different windows updates and initializes a later window with the latest revision', async () => {
    const { AppearanceService } = await import('../../src/main/services/appearance-service')
    let data: Record<string, any> = {
      theme: 'dark',
      codeFontMigrationVersion: 1,
      readingPreferences: {
        uiFontFamily: 'UI',
        editorFontFamily: 'Editor',
        monoFontFamily: 'Custom',
        bodyFontSize: 16,
        codeFontSize: 14,
      },
      providers: [{ apiKey: 'private' }],
    }
    mocks.service = new AppearanceService({
      get: (key) => data[key],
      set: (values) => {
        data = { ...data, ...values }
      },
    })
    const { WindowCoordinator } = await import('../../src/main/window-coordinator')
    const windows: FakeWindow[] = []
    const coordinator = new WindowCoordinator((root) => {
      const window = new FakeWindow(windows.length + 1)
      windows.push(window)
      coordinator.register(window as any, root)
      return window as any
    })
    coordinator.registerHandlers()
    const invoke = (channel: string, id: number, payload?: unknown) =>
      mocks.handlers.get(channel)!({ sender: { id } }, payload)
    await coordinator.create({ workspaceRoot: null })
    await coordinator.create({ workspaceRoot: null })
    await invoke('window:ready', 1)
    await invoke('window:ready', 2)
    const results = await Promise.all([
      invoke('appearance:update', 1, { theme: 'light' }),
      invoke('appearance:update', 2, { readingPreferences: { codeFontSize: 20 } }),
    ])
    expect(results.map((result: any) => result.data.revision)).toEqual([1, 2])
    for (const window of windows) {
      expect(window.webContents.send).toHaveBeenLastCalledWith(
        'appearance:changed',
        expect.objectContaining({
          revision: 2,
          theme: 'light',
          readingPreferences: expect.objectContaining({
            monoFontFamily: 'Custom',
            codeFontSize: 20,
          }),
        }),
      )
    }
    expect(data.providers).toEqual([{ apiKey: 'private' }])
    await coordinator.create({ workspaceRoot: null })
    await invoke('window:ready', 3)
    expect(windows[2].webContents.send).toHaveBeenCalledWith(
      'window:initialize',
      expect.objectContaining({
        revision: 2,
        theme: 'light',
        readingPreferences: expect.objectContaining({ codeFontSize: 20 }),
      }),
    )
  })
})
