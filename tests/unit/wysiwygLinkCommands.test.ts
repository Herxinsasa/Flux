import { describe, expect, it, vi } from 'vitest'
import { editorViewCtx, schemaCtx, type Editor } from '@milkdown/kit/core'
import { Schema, type Node as ProseMirrorNode } from '@milkdown/kit/prose/model'
import { EditorState, TextSelection } from '@milkdown/kit/prose/state'
import { applyWysiwygLink } from '../../src/renderer/src/components/editor/wysiwygMarkdownCommands'

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

function createEditor(children: ProseMirrorNode[], from: number, to: number) {
  const doc = schema.node('doc', null, [schema.node('paragraph', null, children)])
  const view = {
    state: EditorState.create({
      schema,
      doc,
      selection: TextSelection.create(doc, from, to),
    }),
    dispatch(transaction: EditorState['tr']) {
      this.state = this.state.apply(transaction)
    },
    focus: vi.fn(),
  }
  const editor = {
    ctx: {
      get: (key: unknown) => {
        if (key === editorViewCtx) return view
        if (key === schemaCtx) return schema
        return undefined
      },
    },
  } as unknown as Editor
  return { editor, view }
}

function textNodeMarks(view: { state: EditorState }): { text: string; marks: string[] }[] {
  const nodes: { text: string; marks: string[] }[] = []
  view.state.doc.nodesBetween(0, view.state.doc.content.size, (node) => {
    if (!node.isText) return true
    nodes.push({ text: node.text ?? '', marks: node.marks.map((mark) => mark.type.name) })
    return true
  })
  return nodes
}

describe('applyWysiwygLink', () => {
  it('changes only the link mark when the text is unchanged', () => {
    const { editor, view } = createEditor(
      [
        schema.text('ab', [linkMark('old')]),
        schema.text('cd', [linkMark('old'), schema.marks.strong.create()]),
        schema.text('ef', [linkMark('old')]),
      ],
      1,
      7,
    )
    expect(
      applyWysiwygLink(editor, { href: 'new', text: 'abcdef', range: { from: 1, to: 7 } }),
    ).toBe(true)
    expect(textNodeMarks(view)).toEqual([
      { text: 'ab', marks: ['link'] },
      { text: 'cd', marks: ['link', 'strong'] },
      { text: 'ef', marks: ['link'] },
    ])
    const links: string[] = []
    view.state.doc.nodesBetween(0, view.state.doc.content.size, (node) => {
      const link = node.marks.find((mark) => mark.type === schema.marks.link)
      if (link) links.push(String(link.attrs.href))
      return true
    })
    expect(links).toEqual(['new', 'new', 'new'])
  })

  it('keeps non-link marks when the text changes', () => {
    const { editor, view } = createEditor(
      [
        schema.text('ab', [linkMark('old')]),
        schema.text('cd', [linkMark('old'), schema.marks.strong.create()]),
        schema.text('ef', [linkMark('old')]),
      ],
      1,
      7,
    )
    expect(
      applyWysiwygLink(editor, { href: 'new', text: 'xyz', range: { from: 1, to: 7 } }),
    ).toBe(true)
    expect(textNodeMarks(view)).toEqual([{ text: 'xyz', marks: ['link', 'strong'] }])
  })

  it('refuses to replace a selection containing an image', () => {
    const image = schema.node('image', { src: 'a.png', alt: '图' })
    const { editor, view } = createEditor([schema.text('前'), image, schema.text('后')], 1, 4)
    expect(
      applyWysiwygLink(editor, { href: 'new', text: '替换', range: { from: 1, to: 4 } }),
    ).toBe(false)
    expect(view.state.doc.textBetween(1, 4)).toBe('前后')
  })
})
