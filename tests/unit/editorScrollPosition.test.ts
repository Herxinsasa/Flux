import { describe, expect, it } from 'vitest'
import {
  captureConnectedEditorScrollPosition,
  editorScrollRatio,
  editorScrollTopForRatio,
} from '../../src/renderer/src/utils/editorScrollPosition'

describe('editor scroll position mapping', () => {
  it('maps scroll progress between surfaces with different document heights', () => {
    expect(editorScrollRatio({ scrollTop: 450, scrollHeight: 1000, clientHeight: 100 })).toBe(0.5)
    expect(editorScrollTopForRatio({ scrollHeight: 1900, clientHeight: 100 }, 0.5)).toBe(900)
  })

  it('clamps empty and out-of-range scroll positions', () => {
    expect(editorScrollRatio({ scrollTop: 20, scrollHeight: 100, clientHeight: 100 })).toBe(0)
    expect(editorScrollTopForRatio({ scrollHeight: 1000, clientHeight: 100 }, 2)).toBe(900)
  })

  it('keeps the last valid position after the scroll container is detached', () => {
    const captured = captureConnectedEditorScrollPosition(
      { isConnected: true, scrollTop: 450, scrollHeight: 1000, clientHeight: 100 },
      null,
    )

    expect(
      captureConnectedEditorScrollPosition(
        { isConnected: false, scrollTop: 0, scrollHeight: 0, clientHeight: 0 },
        captured,
      ),
    ).toEqual({ scrollTop: 450, scrollRatio: 0.5 })
  })
})
