import { beforeEach, describe, expect, it, vi } from 'vitest'

const saveText = vi.fn()
vi.stubGlobal('window', { electronAPI: { file: { saveText } } })

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
  })
})
