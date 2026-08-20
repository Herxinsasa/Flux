import { describe, expect, it } from 'vitest'
import { Schema } from '@milkdown/prose/model'
import { findTextRangeInProseMirror } from '../../src/renderer/src/components/editor/wysiwygReviewPosition'

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { content: 'inline*', group: 'block' },
    blockquote: { content: 'block+', group: 'block' },
    text: { group: 'inline' },
  },
  marks: {
    inlineCode: {},
    strong: {},
  },
})

describe('WYSIWYG review position mapping', () => {
  it('locates inline code quotes against parsed text', () => {
    const doc = schema.node('doc', null, [
      schema.node('paragraph', null, [
        schema.text('前缀 '),
        schema.text('123', [schema.marks.inlineCode.create()]),
        schema.text(' 后缀'),
      ]),
    ])

    const range = findTextRangeInProseMirror(doc, '`123`')

    expect(range).not.toBeNull()
    expect(doc.textBetween(range!.from, range!.to)).toBe('123')
  })

  it('locates blockquote source markers against rendered block text', () => {
    const doc = schema.node('doc', null, [
      schema.node('blockquote', null, [
        schema.node('paragraph', null, [schema.text('引用块')]),
      ]),
    ])

    const range = findTextRangeInProseMirror(doc, '> 引用块')

    expect(range).not.toBeNull()
    expect(doc.textBetween(range!.from, range!.to)).toBe('引用块')
  })

  it('locates formatted markdown quotes against plain rendered text', () => {
    const doc = schema.node('doc', null, [
      schema.node('paragraph', null, [
        schema.text('重点', [schema.marks.strong.create()]),
      ]),
    ])

    const range = findTextRangeInProseMirror(doc, '**重点**')

    expect(range).not.toBeNull()
    expect(doc.textBetween(range!.from, range!.to)).toBe('重点')
  })
})
