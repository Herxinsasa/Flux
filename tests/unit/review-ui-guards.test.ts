import { describe, expect, it } from 'vitest'
import type { ReviewComment } from '../../src/shared/review'
import { clampReviewComposerPosition } from '../../src/renderer/src/components/editor/WysiwygReviewComposer'
import { haveWysiwygReviewDecorationsChanged } from '../../src/renderer/src/components/editor/wysiwygReviewDecorations'

function comment(overrides: Partial<ReviewComment> = {}): ReviewComment {
  return {
    id: 'comment-1',
    anchor: { start: 10, end: 14, quote: 'Flux', prefix: '', suffix: '', sourceHash: 'source' },
    anchorStatus: 'valid',
    body: 'note',
    status: 'open',
    author: 'user',
    createdAt: '2026-08-21T00:00:00.000Z',
    updatedAt: '2026-08-21T00:00:00.000Z',
    ...overrides,
  }
}

describe('review UI guards', () => {
  it('keeps the composer inside the viewport on every edge', () => {
    expect(clampReviewComposerPosition(760, 560, 292, 150, 800, 600)).toEqual({ left: 500, top: 442 })
    expect(clampReviewComposerPosition(-20, -10, 292, 150, 800, 600)).toEqual({ left: 8, top: 8 })
  })

  it('does not rebuild decorations for anchor offsets moved by normal editing', () => {
    const previous = [comment()]
    const moved = [comment({ anchor: { ...previous[0].anchor, start: 20, end: 24 } })]
    expect(haveWysiwygReviewDecorationsChanged(previous, moved)).toBe(false)
  })

  it('rebuilds decorations when visible review semantics change', () => {
    const previous = [comment()]
    expect(haveWysiwygReviewDecorationsChanged(previous, [comment({ anchorStatus: 'orphaned' })])).toBe(true)
    expect(haveWysiwygReviewDecorationsChanged(previous, [comment({ anchor: { ...previous[0].anchor, quote: 'Flux 2' } })])).toBe(true)
  })
})
