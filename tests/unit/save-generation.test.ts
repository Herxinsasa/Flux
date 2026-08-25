import { beforeEach, describe, expect, it, vi } from 'vitest'

const saveText = vi.fn()
const readText = vi.fn()
const confirm = vi.fn()
const alert = vi.fn()
const discardSource = vi.fn()
vi.stubGlobal('window', {
  electronAPI: { file: { saveText, readText }, backup: { discardSource } },
  confirm,
  alert,
})

import { saveActiveDocument } from '../../src/renderer/src/hooks/useShortcuts'
import { hasDirtyDocument, useFileStore } from '../../src/renderer/src/stores/fileStore'
import { useEditorStore } from '../../src/renderer/src/stores/editorStore'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((next) => { resolve = next })
  return { promise, resolve }
}

describe('save generation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    discardSource.mockResolvedValue({ success: true, data: { discarded: 1 } })
    useFileStore.setState({ currentFile: 'C:\\Docs\\note.txt' })
    useEditorStore.setState({
      activeDocumentPath: 'c:/docs/note.txt',
      content: 'A',
      isDirty: true,
      documentSessions: {
        'c:/docs/note.txt': {
          filePath: 'C:\\Docs\\note.txt',
          draft: 'A',
          dirty: true,
          mode: 'text',
          scrollTop: 0,
          sampled: false,
          lastActivatedAt: 0,
          editGeneration: 1,
          snapshot: {
            filePath: 'C:\\Docs\\note.txt',
            content: 'base',
            encoding: 'utf8',
            lineEnding: 'lf',
            version: { mtimeMs: 1, size: 4, contentHash: 'base' },
            sampled: false,
          },
        },
      },
    })
  })

  it('keeps a later draft dirty when the earlier Ctrl+S response returns', async () => {
    const pending = deferred<any>()
    saveText.mockReturnValue(pending.promise)

    const saving = saveActiveDocument()
    expect(saveText).toHaveBeenCalledWith(expect.objectContaining({ content: 'A' }))

    useEditorStore.getState().setContent('AB')
    pending.resolve({ success: true, data: { version: { mtimeMs: 2, size: 1, contentHash: 'A' } } })
    await saving

    const session = useEditorStore.getState().documentSessions['c:/docs/note.txt']
    expect(session.snapshot?.content).toBe('A')
    expect(session.draft).toBe('AB')
    expect(session.dirty).toBe(true)
    expect(useEditorStore.getState().isDirty).toBe(true)
    expect(hasDirtyDocument('C:\\Docs\\note.txt')).toBe(true)
    expect(discardSource).toHaveBeenCalledWith('C:\\Docs\\note.txt')
  })

  it('reloads the disk snapshot after an external modification conflict is confirmed', async () => {
    saveText.mockResolvedValue({
      success: false,
      code: 'VERSION_CONFLICT',
      error: '文件已变更',
    })
    confirm.mockReturnValue(true)
    readText.mockResolvedValue({
      success: true,
      data: {
        filePath: 'C:\\Docs\\note.txt',
        content: 'external',
        encoding: 'utf8',
        lineEnding: 'lf',
        version: { mtimeMs: 2, size: 8, contentHash: 'external' },
        sampled: false,
      },
    })

    await expect(saveActiveDocument()).resolves.toBe(false)

    expect(confirm).toHaveBeenCalledOnce()
    expect(readText).toHaveBeenCalledWith('C:\\Docs\\note.txt')
    const state = useEditorStore.getState()
    expect(state.content).toBe('external')
    expect(state.isDirty).toBe(false)
    expect(state.documentSessions['c:/docs/note.txt'].snapshot?.version.contentHash).toBe('external')
    expect(discardSource).toHaveBeenCalledWith('C:\\Docs\\note.txt')
  })

  it('keeps the local draft when conflict reload is cancelled', async () => {
    saveText.mockResolvedValue({ success: false, code: 'VERSION_CONFLICT' })
    confirm.mockReturnValue(false)

    await expect(saveActiveDocument()).resolves.toBe(false)

    expect(readText).not.toHaveBeenCalled()
    const state = useEditorStore.getState()
    expect(state.content).toBe('A')
    expect(state.isDirty).toBe(true)
    expect(discardSource).toHaveBeenCalledWith('C:\\Docs\\note.txt')
  })
})
