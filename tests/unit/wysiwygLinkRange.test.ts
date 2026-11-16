import { describe, expect, it } from 'vitest'
import { Schema, type Node as ProseMirrorNode } from '@milkdown/kit/prose/model'
import {
  collectLinkTextMarks,
  findWysiwygLinkRange,
  selectionContainsImage,
} from '../../src/renderer/src/components/editor/wysiwygLinkRange'

const schema = new Schema({
  nodes: {
    doc: { content: 'paragraph+' },
    paragraph: { content: 'inline*', group: 'block' },
    text: { group: 'inline' },
    image: {
      inline: true,
      group: 'inline',
      attrs: { src: {}, alt: { default: null } },
    },
  },
  marks: {
    link: {
      attrs: { href: {}, title: { default: null } },
      inclusive: false,
    },
    strong: {},
  },
})

function linkMark(href: string) {
  return schema.marks.link.create({ href, title: null })
}

function paragraph(...children: ProseMirrorNode[]) {
  return schema.node('doc', null, [schema.node('paragraph', null, children)])
}

describe('findWysiwygLinkRange', () => {
  it('finds the link containing a collapsed cursor', () => {
    const doc = paragraph(
      schema.text('前 '),
      schema.text('链接文本', [linkMark('https://example.com')]),
      schema.text(' 后'),
    )
    expect(findWysiwygLinkRange(doc, 4, 4, schema.marks.link)).toEqual({
      from: 3,
      to: 7,
      href: 'https://example.com',
      text: '链接文本',
    })
  })

  it('expands contiguous text nodes that share the same href', () => {
    const doc = paragraph(
      schema.text('前半', [linkMark('./a.md')]),
      schema.text('后半', [linkMark('./a.md')]),
    )
    expect(findWysiwygLinkRange(doc, 2, 2, schema.marks.link)).toEqual({
      from: 1,
      to: 5,
      href: './a.md',
      text: '前半后半',
    })
  })

  it('expands backward when the cursor is in a later text node', () => {
    const doc = paragraph(
      schema.text('前半', [linkMark('./a.md')]),
      schema.text('后半', [linkMark('./a.md')]),
    )
    expect(findWysiwygLinkRange(doc, 4, 4, schema.marks.link)).toEqual({
      from: 1,
      to: 5,
      href: './a.md',
      text: '前半后半',
    })
  })

  it('keeps a mixed-format link as one range and collects non-link marks', () => {
    const doc = paragraph(
      schema.text('ab', [linkMark('x')]),
      schema.text('cd', [linkMark('x'), schema.marks.strong.create()]),
      schema.text('ef', [linkMark('x')]),
    )
    expect(findWysiwygLinkRange(doc, 6, 6, schema.marks.link)).toEqual({
      from: 1,
      to: 7,
      href: 'x',
      text: 'abcdef',
    })
    expect(
      collectLinkTextMarks(doc, 1, 7, schema.marks.link).map((mark) => mark.type.name),
    ).toEqual(['strong'])
  })

  it('detects image nodes inside a selection', () => {
    const image = schema.node('image', { src: 'a.png', alt: '图' })
    const doc = paragraph(schema.text('前'), image, schema.text('后'))
    expect(selectionContainsImage(doc, 2, 3)).toBe(true)
    expect(selectionContainsImage(doc, 1, 1)).toBe(false)
  })

  it('does not merge adjacent links with different hrefs', () => {
    const doc = paragraph(
      schema.text('甲', [linkMark('a')]),
      schema.text('乙', [linkMark('b')]),
    )
    const found = findWysiwygLinkRange(doc, 1, 1, schema.marks.link)
    expect(found).toEqual({ from: 1, to: 2, href: 'a', text: '甲' })
  })

  it('returns the link intersecting a selection', () => {
    const doc = paragraph(
      schema.text('前 '),
      schema.text('链接', [linkMark('x')]),
      schema.text(' 后'),
    )
    expect(findWysiwygLinkRange(doc, 2, 4, schema.marks.link)?.href).toBe('x')
  })

  it('returns null outside links and right after a link', () => {
    const doc = paragraph(
      schema.text('前 '),
      schema.text('链接', [linkMark('x')]),
      schema.text(' 后'),
    )
    expect(findWysiwygLinkRange(doc, 1, 1, schema.marks.link)).toBeNull()
    expect(findWysiwygLinkRange(doc, 5, 5, schema.marks.link)).toBeNull()
  })
})
