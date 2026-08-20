import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createReviewAnchor, createEmptyReviewSidecar } from '../../src/shared/review'

const run = vi.fn()
const cancel = vi.fn()
const reviewLoad = vi.fn()
const reviewSave = vi.fn()

vi.stubGlobal('window', {
  electronAPI: {
    aiAction: { run, cancel },
    review: { load: reviewLoad, save: reviewSave, export: vi.fn() },
  },
})

import { useAiActionStore } from '../../src/renderer/src/stores/aiActionStore'
import { useReviewStore } from '../../src/renderer/src/stores/reviewStore'

describe('AI action stores', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useAiActionStore.setState({ selections: {}, reviews: {} })
    useReviewStore.setState({ documents: {}, panelOpen: false, activeCommentId: null })
  })

  it('keeps selection output pending until accepted or rejected', async () => {
    run.mockImplementation(async (request: { requestId: string }) => ({ success: true, data: { requestId: request.requestId, rawText: 'Better text' } }))
    await useAiActionStore.getState().runSelection({ action: 'rewrite', sourcePath: 'F:\\a.md', sourceContent: 'Old text', sourceVersion: null, start: 0, end: 8 })
    const pending = useAiActionStore.getState().selections['f:/a.md']
    expect(pending?.status).toBe('ready')
    expect(pending?.result?.rawText).toBe('Better text')
    useAiActionStore.getState().rejectSelection('F:\\a.md')
    expect(useAiActionStore.getState().selections['f:/a.md']).toBeUndefined()
  })

  it('tracks review decisions without writing a sidecar', async () => {
    run.mockImplementation(async (request: { requestId: string }) => ({ success: true, data: { requestId: request.requestId, rawText: JSON.stringify({ findings: [{ id: 'f1', category: 'language', severity: 'info', quote: 'word', start: 0, end: 4, comment: 'Improve wording.' }] }) } }))
    await useAiActionStore.getState().runDocumentReview('F:\\a.md', 'word', null)
    useAiActionStore.getState().decideFindings('F:\\a.md', ['f1'], 'rejected')
    expect(useAiActionStore.getState().reviews['f:/a.md']?.decisions.f1).toBe('rejected')
    expect(reviewSave).not.toHaveBeenCalled()
  })

  it('writes confirmed AI comments in one atomic review save', async () => {
    const sourcePath = 'F:\\a.md'
    const content = 'word'
    reviewLoad.mockResolvedValue({ success: true, data: { sidecar: createEmptyReviewSidecar(sourcePath, content), sidecarVersion: null, readOnly: false } })
    reviewSave.mockImplementation(async ({ sidecar }: { sidecar: ReturnType<typeof createEmptyReviewSidecar> }) => ({ success: true, data: { sidecar, sidecarVersion: null } }))
    await useReviewStore.getState().loadDocument(sourcePath, content)
    const anchor = createReviewAnchor(content, 0, 4)!
    expect(await useReviewStore.getState().addAiComments(sourcePath, content, [{ anchor, body: 'Improve wording.' }])).toBe(true)
    expect(reviewSave).toHaveBeenCalledTimes(1)
    expect(reviewSave.mock.calls[0][0].sidecar.comments[0].author).toBe('ai')
  })
})
