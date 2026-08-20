import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: {
    isPackaged: true,
    getPath: () => process.env.FLUX_TEST_USER_DATA,
  },
}))

import { getPrivateDataRoot, getReleaseMode } from '../../src/main/paths'

describe('release data roots', () => {
  let tempDir: string
  let oldPortableDir: string | undefined
  let oldPortableFile: string | undefined
  let oldPortableFlag: string | undefined

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'Flux-\u53d1\u5e03\u9a8c\u8bc1-'))
    process.env.FLUX_TEST_USER_DATA = path.join(tempDir, 'user-data')
    oldPortableDir = process.env.PORTABLE_EXECUTABLE_DIR
    oldPortableFile = process.env.PORTABLE_EXECUTABLE_FILE
    oldPortableFlag = process.env.FLUX_PORTABLE
    delete process.env.PORTABLE_EXECUTABLE_DIR
    delete process.env.PORTABLE_EXECUTABLE_FILE
    delete process.env.FLUX_PORTABLE
  })

  afterEach(() => {
    for (const [key, value] of [
      ['PORTABLE_EXECUTABLE_DIR', oldPortableDir],
      ['PORTABLE_EXECUTABLE_FILE', oldPortableFile],
      ['FLUX_PORTABLE', oldPortableFlag],
    ] as const) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    delete process.env.FLUX_TEST_USER_DATA
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  it('uses userData for an installed release', () => {
    expect(getReleaseMode()).toBe('installed')
    expect(getPrivateDataRoot()).toBe(path.join(tempDir, 'user-data'))
  })

  it('uses a Unicode executable directory data folder for portable releases', () => {
    const executableDir = path.join(tempDir, '\u4fbf\u643a\u7248')
    process.env.PORTABLE_EXECUTABLE_DIR = executableDir

    expect(getReleaseMode()).toBe('portable')
    expect(getPrivateDataRoot()).toBe(path.join(executableDir, 'data'))
    expect(fs.existsSync(path.join(executableDir, 'data'))).toBe(true)
  })
})
