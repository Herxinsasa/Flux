import { beforeEach, describe, expect, it, vi } from 'vitest'
import '../../src/renderer/src/registry/builtinModes'
import { useEditorStore } from '../../src/renderer/src/stores/editorStore'
import {
  confirmUnsavedDocument,
  listDirtyDocumentPaths,
  registerUnsavedPrompt,
} from '../../src/renderer/src/utils/unsavedChangesGuard'

const saveText = vi.fn()

vi.stubGlobal('window', {
  electronAPI: { file: { saveText } },
  alert: vi.fn(),
  confirm: vi.fn(),
})

function loadDirtyDocument(): void {
  useEditorStore.getState().setDocumentSnapshot('C:\\docs\\note.md', {
    filePath: 'C:\\docs\\note.md',
    content: '# saved',
    encoding: 'utf8',
    lineEnding: 'lf',
    version: { mtimeMs: 1, size: 7, contentHash: 'saved' },
    sampled: false,
  })
  useEditorStore.getState().setContent('# changed')
}

describe('unsaved document guard', () => {
  beforeEach(() => {
    useEditorStore.setState({ activeDocumentPath: null, documentSessions: {}, content: '', isDirty: false })
    saveText.mockReset()
  })

  it('keeps the draft when the user cancels', async () => {
    loadDirtyDocument()
    const unregister = registerUnsavedPrompt(async () => 'cancel')
    await expect(confirmUnsavedDocument('C:\\docs\\note.md')).resolves.toBe(false)
    expect(useEditorStore.getState().content).toBe('# changed')
    unregister()
  })

  it('restores the snapshot when the user discards', async () => {
    loadDirtyDocument()
    const unregister = registerUnsavedPrompt(async () => 'discard')
    await expect(confirmUnsavedDocument('C:\\docs\\note.md')).resolves.toBe(true)
    expect(useEditorStore.getState().content).toBe('# saved')
    expect(useEditorStore.getState().isDirty).toBe(false)
    unregister()
  })

  it('continues only after a successful save', async () => {
    loadDirtyDocument()
    saveText.mockResolvedValue({
      success: true,
      data: { version: { mtimeMs: 2, size: 9, contentHash: 'changed' } },
    })
    const unregister = registerUnsavedPrompt(async () => 'save')
    await expect(confirmUnsavedDocument('C:\\docs\\note.md')).resolves.toBe(true)
    expect(saveText).toHaveBeenCalledOnce()
    expect(useEditorStore.getState().isDirty).toBe(false)
    unregister()
  })

  it('includes dirty background sessions when closing', () => {
    loadDirtyDocument()
    useEditorStore.setState((state) => ({
      documentSessions: {
        ...state.documentSessions,
        'c:/docs/background.md': {
          ...state.documentSessions['c:/docs/note.md'],
          filePath: 'C:\\docs\\background.md',
          dirty: true,
          lastActivatedAt: Date.now() + 1,
        },
      },
    }))
    expect(listDirtyDocumentPaths()).toEqual([
      'C:\\docs\\background.md',
      'C:\\docs\\note.md',
    ])
  })
})
