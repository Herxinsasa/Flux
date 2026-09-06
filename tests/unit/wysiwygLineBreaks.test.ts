import { describe, expect, it } from 'vitest'
import {
  hasTrailingMarkdownHardBreak,
  normalizeWysiwygMarkdown,
  preserveTrailingMarkdownHardBreak,
  serializeMarkdownHardBreak,
} from '../../src/renderer/src/components/editor/wysiwygLineBreaks'

describe('WYSIWYG line break serialization', () => {
  it('uses a portable two-space hard break instead of a backslash marker', () => {
    expect(serializeMarkdownHardBreak()).toBe('  \n')
  })

  it('retains a Shift+Enter hard break at the end of the document', () => {
    expect(preserveTrailingMarkdownHardBreak('text\n', true)).toBe('text  \n')
    expect(preserveTrailingMarkdownHardBreak('text  \n', true)).toBe('text  \n')
    expect(preserveTrailingMarkdownHardBreak('text\n', false)).toBe('text\n')
    expect(hasTrailingMarkdownHardBreak('text\\\n')).toBe(true)
  })

  it('keeps literal single tildes readable while preserving backslashes and code fences', () => {
    expect(normalizeWysiwygMarkdown('\\~123\\~')).toBe('~123~')
    expect(normalizeWysiwygMarkdown('\\~\\~123\\~\\~')).toBe('~~123~~')
    expect(normalizeWysiwygMarkdown('\\\\~123')).toBe('\\\\~123')
    expect(normalizeWysiwygMarkdown('\\~~~ fence')).toBe('\\~~~ fence')
  })
})
