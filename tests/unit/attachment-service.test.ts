import fs from 'fs/promises'
import os from 'os'
import path from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import { saveImageAttachment } from '../../src/main/services/attachment-service'

const roots: string[] = []
async function fixture(): Promise<string> { const root = await fs.mkdtemp(path.join(os.tmpdir(), 'flux-attachment-')); roots.push(root); return root }
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))) })

describe('saveImageAttachment', () => {
  it('stores a supported image beside Markdown and returns a POSIX relative path', async () => {
    const root = await fixture(); const sourcePath = path.join(root, 'notes.md'); await fs.writeFile(sourcePath, '# notes')
    const result = await saveImageAttachment({ sourcePath, bytes: new Uint8Array([1, 2, 3]), mime: 'image/png' })
    expect(result.relativePath).toMatch(/^notes\.assets\/.+\.png$/)
    await expect(fs.stat(path.join(root, ...result.relativePath.split('/')))).resolves.toBeDefined()
  })
  it('rejects unsupported mime and oversized payloads before a link can be produced', async () => {
    const root = await fixture(); const sourcePath = path.join(root, 'notes.md')
    await expect(saveImageAttachment({ sourcePath, bytes: new Uint8Array([1]), mime: 'image/svg+xml' })).rejects.toThrow('Only PNG')
    await expect(saveImageAttachment({ sourcePath, bytes: new Uint8Array(20 * 1024 * 1024 + 1), mime: 'image/png' })).rejects.toThrow('20 MB')
  })
})
