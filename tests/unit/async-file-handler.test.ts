import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const ipc = vi.hoisted(() => ({ handlers: new Map<string, (...args: any[]) => Promise<any>>() }))
vi.mock('electron', () => ({
  app: { isPackaged: false },
  BrowserWindow: { getFocusedWindow: vi.fn() },
  dialog: {},
  ipcMain: {
    handle: (channel: string, handler: (...args: any[]) => Promise<any>) =>
      ipc.handlers.set(channel, handler),
    on: vi.fn(),
    once: vi.fn(),
  },
}))

import { registerFileHandlers } from '../../src/main/ipc/file-handlers'
import { readText, saveText } from '../../src/main/services/file-service'

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'flux-async-read-'))

beforeAll(() => registerFileHandlers())
afterAll(() => fs.rmSync(directory, { recursive: true, force: true }))

describe('asynchronous FILE_READ_TEXT', () => {
  it.each([
    ['UTF-8', Buffer.from('中文\r\nbody', 'utf8')],
    [
      'UTF-16LE',
      Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('中文\r\nbody', 'utf16le')]),
    ],
    [
      'UTF-16BE',
      Buffer.concat([Buffer.from([0xfe, 0xff]), Buffer.from('中文\r\nbody', 'utf16le').swap16()]),
    ],
  ])('returns the same content, encoding, line endings and version for %s', async (name, bytes) => {
    const filePath = path.join(directory, `${name}.md`)
    fs.writeFileSync(filePath, bytes)
    const expected = readText(filePath)
    const response = await ipc.handlers.get('file:read-text')!({ sender: {} }, filePath)
    expect(response).toEqual({ success: true, data: expected })
  })

  it('preserves invalid and missing path error codes', async () => {
    const read = ipc.handlers.get('file:read-text')!
    expect(await read({ sender: {} }, '')).toMatchObject({ success: false, code: 'INVALID_DATA' })
    expect(await read({ sender: {} }, path.join(directory, 'missing.md'))).toMatchObject({
      success: false,
      code: 'NOT_FOUND',
    })
    const binaryPath = path.join(directory, 'binary.md')
    fs.writeFileSync(binaryPath, Buffer.from([0, 1, 2]))
    expect(await read({ sender: {} }, binaryPath)).toMatchObject({
      success: false,
      code: 'UNSUPPORTED_FORMAT',
    })
  })

  it('rejects a save if the file changes after an asynchronous snapshot', async () => {
    const filePath = path.join(directory, 'conflict.md')
    fs.writeFileSync(filePath, 'before')
    const response = await ipc.handlers.get('file:read-text')!({ sender: {} }, filePath)
    fs.writeFileSync(filePath, 'external update')
    await expect(
      saveText({
        filePath,
        content: 'draft',
        encoding: response.data.encoding,
        lineEnding: response.data.lineEnding,
        expectedVersion: response.data.version,
      }),
    ).rejects.toMatchObject({ code: 'VERSION_CONFLICT' })
    expect(fs.readFileSync(filePath, 'utf8')).toBe('external update')
  })
})
