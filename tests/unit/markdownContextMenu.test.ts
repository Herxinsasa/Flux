import { describe, expect, it } from 'vitest'
import { createSourceMarkdownEdit } from '../../src/renderer/src/components/editor/sourceMarkdownCommands'

describe('source Markdown context commands', () => {
  it('wraps an inline selection and keeps the inner selection', () => {
    expect(createSourceMarkdownEdit('bold', 'hello world', 0, 5)).toEqual({
      from: 0,
      to: 5,
      insert: '**hello**',
      selection: { anchor: 2, head: 7 },
    })
  })

  it('applies a heading to the current paragraph without a selection', () => {
    expect(createSourceMarkdownEdit('heading-2', 'before\ntitle\nafter', 9, 9)).toMatchObject({
      from: 7,
      to: 12,
      insert: '## title',
    })
  })

  it('converts selected lines to a task list', () => {
    expect(createSourceMarkdownEdit('task-list', 'one\ntwo', 0, 7)?.insert).toBe('- [ ] one\n- [ ] two')
  })

  it('inserts a table at an empty cursor', () => {
    expect(createSourceMarkdownEdit('insert-table', '', 0, 0)?.insert).toContain('| --- | --- |')
  })

  it('does not apply selection-only commands without selected text', () => {
    expect(createSourceMarkdownEdit('italic', 'text', 2, 2)).toBeNull()
  })
})
