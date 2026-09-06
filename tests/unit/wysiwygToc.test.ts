import { describe, expect, it, vi } from 'vitest'

const { near } = vi.hoisted(() => ({ near: vi.fn(() => ({ type: 'near' })) }))

vi.mock('@milkdown/kit/prose/state', () => ({
  TextSelection: { near },
}))
vi.mock('@milkdown/kit/utils', () => ({
  $node: vi.fn((name: string, factory: () => unknown) => ({ name, spec: factory() })),
  $prose: vi.fn((factory: unknown) => factory),
  $remark: vi.fn((_name: string, factory: () => unknown) => ({ plugin: factory() })),
  $view: vi.fn((node: unknown, factory: unknown) => ({ node, factory })),
}))

import {
  collectWysiwygTocHeadings,
  registerTocStringify,
  tocNode,
  tocNodeView,
  transformStandaloneTocNodes,
} from '../../src/renderer/src/components/editor/wysiwygToc'

function headingNode(level: number, text: string) {
  return {
    type: { name: 'heading' },
    attrs: { level },
    descendants: (callback: (node: { isText: boolean; text?: string }) => void) => {
      callback({ isText: true, text })
    },
  }
}

function documentWithHeadings() {
  const headings = [
    headingNode(1, '中文标题'),
    headingNode(2, '重复标题'),
    headingNode(2, '重复标题'),
  ]
  return {
    content: { size: 30 },
    resolve: (position: number) => ({ position }),
    descendants: (callback: (node: unknown, position: number) => void) => {
      headings.forEach((node, index) => callback(node, index * 5))
    },
  }
}

describe('WYSIWYG TOC', () => {
  it('converts only a standalone marker and leaves inline or fenced markers intact', () => {
    const tree = {
      type: 'root',
      children: [
        {
          type: 'paragraph',
          position: { start: { offset: 0 }, end: { offset: 5 } },
          children: [{ type: 'text', value: '[TOC]' }],
        },
        {
          type: 'paragraph',
          position: { start: { offset: 6 }, end: { offset: 19 } },
          children: [{ type: 'text', value: 'before [TOC]' }],
        },
        { type: 'code', position: { start: { offset: 20 }, end: { offset: 36 } }, value: '[TOC]' },
        {
          type: 'list',
          children: [{ type: 'paragraph', children: [{ type: 'text', value: '[TOC]' }] }],
        },
        {
          type: 'blockquote',
          children: [{ type: 'paragraph', children: [{ type: 'text', value: '[TOC]' }] }],
        },
      ],
    }

    transformStandaloneTocNodes(tree, '[TOC]\nbefore [TOC]\n```\n[TOC]\n```')

    expect(tree.children?.map((node) => node.type)).toEqual([
      'toc',
      'paragraph',
      'code',
      'list',
      'blockquote',
    ])
    expect(tree.children?.[3]?.children?.[0]?.type).toBe('paragraph')
    expect(tree.children?.[4]?.children?.[0]?.type).toBe('paragraph')
  })

  it('collects heading levels, text and document positions for duplicate Chinese headings', () => {
    expect(collectWysiwygTocHeadings(documentWithHeadings() as never)).toEqual([
      { level: 1, position: 1, text: '中文标题' },
      { level: 2, position: 6, text: '重复标题' },
      { level: 2, position: 11, text: '重复标题' },
    ])
  })

  it('serializes the WYSIWYG TOC node back to an exact standalone marker', () => {
    const addNode = vi.fn()
    const runner = (
      tocNode as { spec: { toMarkdown: { runner: (state: { addNode: typeof addNode }) => void } } }
    ).spec.toMarkdown.runner

    runner({ addNode })

    expect(addNode).toHaveBeenCalledWith('toc')

    const update = vi.fn()
    registerTocStringify({
      get: () => ({ handlers: { paragraph: vi.fn() } }),
      update,
    } as never)
    const optionsFactory = update.mock.calls[0]?.[1] as () => { handlers: { toc: () => string } }
    expect(optionsFactory().handlers.toc()).toBe('[TOC]')
  })

  it('jumps to the selected heading and focuses the editor', () => {
    const state = {
      doc: documentWithHeadings(),
      tr: {
        setSelection: vi.fn().mockReturnThis(),
        scrollIntoView: vi.fn().mockReturnThis(),
      },
    }
    const editorView = {
      state,
      dispatch: vi.fn(),
      focus: vi.fn(),
    }
    const factory = (
      tocNodeView as {
        factory: () => (node: unknown, view: typeof editorView) => { dom: HTMLElement }
      }
    ).factory()
    const nodeView = factory({}, editorView)
    const links = [...nodeView.dom.querySelectorAll<HTMLButtonElement>('.markdown-toc-link')]

    links[1]?.click()

    expect(near).toHaveBeenCalledWith(state.doc.resolve(6))
    expect(state.tr.setSelection).toHaveBeenCalledWith({ type: 'near' })
    expect(editorView.dispatch).toHaveBeenCalledWith(state.tr)
    expect(editorView.focus).toHaveBeenCalled()
  })
})
