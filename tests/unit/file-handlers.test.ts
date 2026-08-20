import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: { isPackaged: false },
  BrowserWindow: { getFocusedWindow: vi.fn() },
  dialog: {},
  ipcMain: { handle: vi.fn(), on: vi.fn(), once: vi.fn() },
}))

import { isOptionalWorkspaceRoot, isValidFilePath } from '../../src/main/ipc/file-handlers'

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
})
