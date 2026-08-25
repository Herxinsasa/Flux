import { describe, expect, it } from 'vitest'
import { serializeMarkdownHardBreak } from '../../src/renderer/src/components/editor/wysiwygLineBreaks'

describe('WYSIWYG line break serialization', () => {
  it('uses a portable two-space hard break instead of a backslash marker', () => {
    expect(serializeMarkdownHardBreak()).toBe('  \n')
  })
})
