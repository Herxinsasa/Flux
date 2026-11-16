import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterAll, describe, expect, it, vi } from 'vitest'
import '../../src/renderer/src/registry/builtinModes'
import { readText } from '../../src/main/services/file-service'
import { useEditorStore } from '../../src/renderer/src/stores/editorStore'
import { useFileStore } from '../../src/renderer/src/stores/fileStore'
import { saveDocument } from '../../src/renderer/src/utils/documentSave'

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'flux-size-boundary-'))
const boundary = 5 * 1024 * 1024

afterAll(() => fs.rmSync(directory, { recursive: true, force: true }))

function makeFixture(name: string, data: Buffer): string {
  const filePath = path.join(directory, name)
  fs.writeFileSync(filePath, data)
  return filePath
}

describe('large Markdown byte boundaries', () => {
  it.each([
    ['utf8-ascii', Buffer.alloc(boundary + 1, 'a'), 'utf8'],
    [
      'utf8-chinese',
      Buffer.concat([Buffer.from('中'.repeat(Math.ceil(boundary / 3)), 'utf8'), Buffer.from('a')]),
      'utf8',
    ],
    [
      'utf16le-crlf',
      Buffer.concat([
        Buffer.from([0xff, 0xfe]),
        Buffer.from('\r\n'.repeat(boundary / 4), 'utf16le'),
      ]),
      'utf16le',
    ],
    [
      'utf16be-chinese',
      Buffer.concat([
        Buffer.from([0xfe, 0xff]),
        Buffer.from('中'.repeat(boundary / 2), 'utf16le').swap16(),
      ]),
      'utf16be',
    ],
  ] as const)('uses source mode above 5 MiB for %s', (name, data, encoding) => {
    const filePath = makeFixture(`${name}.md`, data)
    const snapshot = readText(filePath)
    expect(snapshot.version.size).toBeGreaterThan(boundary)
    expect(snapshot.encoding).toBe(encoding)
    useEditorStore.getState().setDocumentSnapshot(filePath, snapshot)
    expect(useEditorStore.getState().markdownEditSurface).toBe('source')
    expect(
      useEditorStore.getState().documentSessions[filePath.replace(/\\/g, '/').toLowerCase()]
        .sampled,
    ).toBe(false)
  })

  it.each([5_000_000, 5_000_001, boundary - 1, boundary, boundary + 1])(
    'retains a complete source snapshot at %s bytes',
    (size) => {
      const filePath = makeFixture(`size-${size}.md`, Buffer.alloc(size, 'a'))
      const snapshot = readText(filePath)
      expect(snapshot.version.size).toBe(size)
      expect(snapshot.content.length).toBe(size)
      useEditorStore.getState().setDocumentSnapshot(filePath, snapshot)
      expect(useEditorStore.getState().markdownEditSurface).toBe('source')
      expect(
        useEditorStore.getState().documentSessions[filePath.replace(/\\/g, '/').toLowerCase()]
          .snapshot,
      ).not.toBeNull()
    },
  )

  it('never saves a sampled document', async () => {
    const filePath = path.join(directory, 'sample.md')
    const saveText = vi.fn()
    Object.defineProperty(window, 'electronAPI', {
      configurable: true,
      value: { file: { saveText } },
    })
    useEditorStore.getState().setSampledDocument(filePath, 'partial', 'markdown')
    useEditorStore.getState().setContent('changed sample')
    expect(await saveDocument(filePath)).toBe(false)
    expect(saveText).not.toHaveBeenCalled()
  })

  it('samples a real file above 16 MiB and refuses to overwrite it', async () => {
    const original = Buffer.alloc(16 * 1024 * 1024 + 2)
    for (let index = 0; index < original.length; index += 2) {
      original[index] = 120
      original[index + 1] = 10
    }
    const filePath = makeFixture('large.md', original)
    const saveText = vi.fn()
    Object.defineProperty(window, 'electronAPI', {
      configurable: true,
      value: {
        file: {
          getInfo: async () => ({
            success: true,
            data: {
              path: filePath,
              name: 'large.md',
              size: original.length,
              extension: '.md',
              lines: original.length / 2,
              encoding: 'utf8',
            },
          }),
          readStream: (_path: string, callback: (chunk: string | null) => void) => {
            const stream = fs.createReadStream(filePath, { encoding: 'utf8', highWaterMark: 4096 })
            stream.on('data', (chunk) => callback(String(chunk)))
            stream.on('end', () => callback(null))
            return () => stream.destroy()
          },
          saveText,
        },
        document: {
          reserve: async () => ({
            success: true,
            data: { status: 'reserved', filePath, reservationId: 'test' },
          }),
          commit: async () => ({ success: true }),
          release: async () => ({ success: true }),
        },
        recent: { record: async () => ({ success: true }) },
      },
    })
    useFileStore.setState({ files: [], currentFile: null, mru: [] })
    useEditorStore.setState({
      documentSessions: {},
      activeDocumentPath: null,
      content: '',
      isDirty: false,
    })
    await useFileStore.getState().openFile(filePath)
    const session =
      useEditorStore.getState().documentSessions[filePath.replace(/\\/g, '/').toLowerCase()]
    expect(session.sampled).toBe(true)
    expect(session.snapshot).toBeNull()
    expect(await saveDocument(filePath)).toBe(false)
    expect(saveText).not.toHaveBeenCalled()
    expect(fs.readFileSync(filePath).equals(original)).toBe(true)
  })
})
