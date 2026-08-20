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

  it('rejects missing, relative, and unsupported paths', () => {
    expect(extractOpenFilePath(['notes.md', path.join(os.tmpdir(), 'missing.txt')])).toBeNull()
  })
})
