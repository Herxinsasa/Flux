import fs from 'fs/promises'
import os from 'os'
import path from 'path'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: { isPackaged: false },
  BrowserWindow: { getFocusedWindow: vi.fn() },
  dialog: {},
  ipcMain: { handle: vi.fn(), on: vi.fn(), once: vi.fn() },
}))

import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '../../src/shared/ipc-channels'
import { isOptionalWorkspaceRoot, isValidFilePath, registerFileHandlers } from '../../src/main/ipc/file-handlers'

const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })))
})

describe('file handler argument validation', () => {
  it('accepts only non-empty file paths for FILE_READ_TEXT', () => {
    expect(isValidFilePath('notes.md')).toBe(true)
    expect(isValidFilePath('')).toBe(false)
    expect(isValidFilePath(undefined)).toBe(false)
    expect(isValidFilePath({ requestedRoot: 'C:\\workspace' })).toBe(false)
  })

  it('accepts an optional root only for FILE_OPEN_FOLDER', () => {
    expect(isOptionalWorkspaceRoot('C:\\workspace')).toBe(true)
    expect(isOptionalWorkspaceRoot(undefined)).toBe(false)
    expect(isOptionalWorkspaceRoot(null)).toBe(false)
  })

  it('opens a workspace without creating Flux configuration inside it', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'flux-workspace-'))
    temporaryRoots.push(root)
    const handlers = new Map<string, (...args: any[]) => Promise<any>>()
    vi.mocked(ipcMain.handle).mockImplementation((channel, listener) => {
      handlers.set(channel, listener as (...args: any[]) => Promise<any>)
      return undefined as never
    })
    registerFileHandlers()

    const response = await handlers.get(IPC_CHANNELS.FILE_OPEN_FOLDER)?.({ sender: {} }, root)

    expect(response).toEqual({ success: true, data: { root: path.resolve(root), files: [] } })
    await expect(fs.stat(path.join(root, 'config'))).rejects.toMatchObject({ code: 'ENOENT' })
  })
})
