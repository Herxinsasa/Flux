import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createEmptyReviewSidecar, createReviewAnchor } from '../../src/shared/review'

const load = vi.fn()
const save = vi.fn()
vi.stubGlobal('window', { electronAPI: { review: { load, save, export: vi.fn() } } })

import { useReviewStore } from '../../src/renderer/src/stores/reviewStore'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((next) => { resolve = next })
  return { promise, resolve }
}

describe('review save generation', () => {
  const sourcePath = 'C:\\Docs\\note.md'
  const initialContent = 'hello'

  beforeEach(() => {
    vi.clearAllMocks()
    useReviewStore.setState({ documents: {}, panelOpen: false, activeCommentId: null })
    load.mockResolvedValue({
      success: true,
      data: { sidecar: createEmptyReviewSidecar(sourcePath, initialContent), sidecarVersion: null, readOnly: false },
    })
  })

  it('does not let an old sidecar response overwrite a newer reanchor', async () => {
    const first = deferred<any>()
    save.mockImplementationOnce(() => first.promise).mockImplementationOnce(async ({ sidecar }: any) => ({
      success: true,
      data: { sidecar, sidecarVersion: { mtimeMs: 2, size: 1, contentHash: 'latest' } },
    }))
    await useReviewStore.getState().loadDocument(sourcePath, initialContent)
    const anchor = createReviewAnchor(initialContent, 0, 5)!

    const saving = useReviewStore.getState().addComment(sourcePath, initialContent, anchor, 'note')
    const firstSidecar = save.mock.calls[0][0].sidecar
    useReviewStore.getState().reanchorDocument(sourcePath, 'prefix hello')

    first.resolve({
      success: true,
      data: { sidecar: firstSidecar, sidecarVersion: { mtimeMs: 1, size: 1, contentHash: 'stale' } },
    })
    await saving

    const document = useReviewStore.getState().documents['c:/docs/note.md']
    expect(save).toHaveBeenCalledTimes(2)
    expect(document.sidecar.sourceHash).not.toBe(firstSidecar.sourceHash)
    expect(document.sidecar.comments[0].anchor.start).toBe(7)
    expect(document.saving).toBe(false)
  })

  it('does not let a concurrent reload erase a reply save in flight', async () => {
    await useReviewStore.getState().loadDocument(sourcePath, initialContent)
    const anchor = createReviewAnchor(initialContent, 0, 5)!
    save.mockImplementation(async ({ sidecar }: any) => ({
      success: true,
      data: { sidecar, sidecarVersion: { mtimeMs: Date.now(), size: 1, contentHash: 'saved' } },
    }))
    await useReviewStore.getState().addComment(sourcePath, initialContent, anchor, 'review')

    const pendingSave = deferred<any>()
    save.mockImplementationOnce(() => pendingSave.promise)
    load.mockResolvedValueOnce({
      success: true,
      data: { sidecar: createEmptyReviewSidecar(sourcePath, initialContent), sidecarVersion: null, readOnly: false },
    })
    const replying = useReviewStore.getState().addReply(sourcePath, initialContent, useReviewStore.getState().documents['c:/docs/note.md'].sidecar.comments[0].id, 'fixed', 'modifier')
    await useReviewStore.getState().loadDocument(sourcePath, initialContent)
    const requestSidecar = save.mock.calls.at(-1)![0].sidecar
    pendingSave.resolve({ success: true, data: { sidecar: requestSidecar, sidecarVersion: { mtimeMs: 3, size: 1, contentHash: 'reply' } } })
    await replying

    expect(useReviewStore.getState().documents['c:/docs/note.md'].sidecar.comments[0].replies?.[0].body).toBe('fixed')
  })

  it('caps follow-up saves while anchors keep moving', async () => {
    await useReviewStore.getState().loadDocument(sourcePath, initialContent)
    const anchor = createReviewAnchor(initialContent, 0, 5)!
    save.mockImplementation(async ({ sidecar }: any) => {
      const prefix = 'x'.repeat(save.mock.calls.length)
      useReviewStore.getState().reanchorDocument(sourcePath, `${prefix}${initialContent}`)
      return {
        success: true,
        data: {
          sidecar,
          sidecarVersion: { mtimeMs: save.mock.calls.length, size: 1, contentHash: `save-${save.mock.calls.length}` },
        },
      }
    })

    const saved = await useReviewStore.getState().addComment(sourcePath, initialContent, anchor, 'note')

    expect(saved).toBe(true)
    expect(save).toHaveBeenCalledTimes(3)
    expect(useReviewStore.getState().documents['c:/docs/note.md'].saving).toBe(false)
  })
})
