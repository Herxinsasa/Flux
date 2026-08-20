import { describe, expect, it } from 'vitest'
import { resolveSerializedReviewAnchor } from '../../src/renderer/src/components/editor/wysiwygReviewAnchor'

describe('WYSIWYG review anchor mapping', () => {
  it('uses serialized markers to avoid matching link destinations', () => {
    const source = '[链接](foo) foo'
    const marked = '[链接](foo) FLUXSTARTfooFLUXEND'
    const anchor = resolveSerializedReviewAnchor(source, marked, 'FLUXSTART', 'FLUXEND')
    expect(source.slice(anchor?.start, anchor?.end)).toBe('foo')
    expect(anchor?.start).toBe(source.lastIndexOf('foo'))
  })

  it('maps a formatted selection when canonical spacing differs', () => {
    const source = '# 标题\n\n**重点**'
    const marked = '# 标题\n\n**FLUXSTART重点FLUXEND**\n'
    const anchor = resolveSerializedReviewAnchor(source, marked, 'FLUXSTART', 'FLUXEND')
    expect(source.slice(anchor?.start, anchor?.end)).toBe('重点')
  })
})
