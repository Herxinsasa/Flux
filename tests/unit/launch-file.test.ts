import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import { extractOpenFilePath } from '../../src/shared/launch-file'

const tempPaths: string[] = []

afterEach(() => {
  for (const tempPath of tempPaths.splice(0)) fs.rmSync(tempPath, { force: true })
})

describe('extractOpenFilePath', () => {
  it('selects the first existing supported text file', () => {
    const filePath = path.join(os.tmpdir(), `flux-launch-${Date.now()}.markdown`)
    fs.writeFileSync(filePath, '# Flux')
    tempPaths.push(filePath)

    expect(extractOpenFilePath(['electron.exe', filePath])).toBe(filePath)
  })

  it('resolves relative and missing paths so they can produce a useful error', () => {
    expect(extractOpenFilePath(['notes.md'], os.tmpdir())).toBe(path.join(os.tmpdir(), 'notes.md'))
    const missing = path.join(os.tmpdir(), 'missing.txt')
    expect(extractOpenFilePath([missing])).toBe(missing)
  })

  it('ignores Electron flags and unsupported paths', () => {
    expect(
      extractOpenFilePath(['--log-file', 'electron.log', '--trace-warnings', 'electron.exe']),
    ).toBeNull()
    expect(extractOpenFilePath(['--user-data-dir=C:\\tmp.log', 'file.md'], os.tmpdir())).toBe(
      path.join(os.tmpdir(), 'file.md'),
    )
  })
})
