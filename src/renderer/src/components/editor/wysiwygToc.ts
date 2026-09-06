import { remarkStringifyOptionsCtx } from '@milkdown/kit/core'
import type { Ctx } from '@milkdown/kit/ctx'
import type { Node as ProseMirrorNode } from '@milkdown/kit/prose/model'
import { Plugin, TextSelection } from '@milkdown/kit/prose/state'
import type { EditorView, NodeView, ViewMutationRecord } from '@milkdown/kit/prose/view'
import { $node, $prose, $remark, $view } from '@milkdown/kit/utils'

import { plainHeadingText } from '../../utils/markdownHeadingIds'

const TOC_MARKER_PATTERN = /^[ \t]*\[toc\][ \t]*$/i

interface MarkdownAstPosition {
  start?: { offset?: number }
  end?: { offset?: number }
}

interface MarkdownAstNode {
  type: string
  value?: string
  children?: MarkdownAstNode[]
  position?: MarkdownAstPosition
}

export interface WysiwygTocHeading {
  level: number
  position: number
  text: string
}

function sourceForNode(node: MarkdownAstNode, source: string): string | null {
  const start = node.position?.start?.offset
  const end = node.position?.end?.offset
  if (start == null || end == null || start < 0 || end < start || end > source.length) return null
  return source.slice(start, end)
}

export function transformStandaloneTocNodes(node: MarkdownAstNode, source: string): void {
  // A TOC marker is a document-level extension. Do not reinterpret text inside
  // list items, blockquotes, or other nested containers.
  if (node.type !== 'root' || !node.children) return
  node.children = node.children.map((child) => {
    const markerSource = sourceForNode(child, source)
    const isPlainMarker =
      child.type === 'paragraph' &&
      child.children?.length === 1 &&
      child.children[0].type === 'text' &&
      TOC_MARKER_PATTERN.test(markerSource ?? child.children[0].value ?? '')
    if (isPlainMarker) {
      return { type: 'toc', position: child.position }
    }
    return child
  })
}

export const tocRemarkPlugin = $remark(
  'flux-toc',
  () => () => (tree: MarkdownAstNode, file: { toString(): string }) => {
    transformStandaloneTocNodes(tree, file.toString())
  },
)

export const tocNode = $node('toc', () => ({
  group: 'block',
  atom: true,
  selectable: false,
  parseDOM: [{ tag: 'nav.flux-wysiwyg-toc' }],
  toDOM: () => ['nav', { class: 'markdown-toc flux-wysiwyg-toc', 'aria-label': '目录' }],
  parseMarkdown: {
    match: ({ type }) => type === 'toc',
    runner: (state, _node, type) => {
      state.addNode(type)
    },
  },
  toMarkdown: {
    match: (node) => node.type.name === 'toc',
    runner: (state) => {
      state.addNode('toc')
    },
  },
}))

export function registerTocStringify(ctx: Ctx): void {
  const original = ctx.get(remarkStringifyOptionsCtx)
  ctx.update(remarkStringifyOptionsCtx, () => ({
    ...original,
    handlers: {
      ...(original.handlers as Record<string, unknown>),
      toc: () => '[TOC]',
    },
  }))
}

function headingText(node: ProseMirrorNode): string {
  let text = ''
  node.descendants((child) => {
    if (child.isText && child.text) text += child.text
    else if (child.type.name === 'image') text += (child.attrs.alt as string | undefined) ?? ''
  })
  return plainHeadingText(text)
}

export function collectWysiwygTocHeadings(document: ProseMirrorNode): WysiwygTocHeading[] {
  const headings: WysiwygTocHeading[] = []
  document.descendants((node, position) => {
    if (node.type.name !== 'heading') return
    const level = Number(node.attrs.level)
    const text = headingText(node)
    if (level >= 1 && level <= 6 && text) headings.push({ level, position: position + 1, text })
    return false
  })
  return headings
}

const tocViewsByEditor = new WeakMap<EditorView, Set<WysiwygTocView>>()

class WysiwygTocView implements NodeView {
  readonly dom: HTMLElement

  private signature = ''
  private readonly view: EditorView
  private readonly onClick = (event: MouseEvent) => {
    const target =
      event.target instanceof Element
        ? event.target.closest<HTMLButtonElement>('.markdown-toc-link')
        : null
    const position = Number(target?.dataset.position)
    if (
      !target ||
      !Number.isInteger(position) ||
      position < 1 ||
      position > this.view.state.doc.content.size
    )
      return
    event.preventDefault()
    this.view.dispatch(
      this.view.state.tr
        .setSelection(TextSelection.near(this.view.state.doc.resolve(position)))
        .scrollIntoView(),
    )
    this.view.focus()
  }

  constructor(view: EditorView) {
    this.view = view
    this.dom = document.createElement('nav')
    this.dom.className = 'markdown-toc flux-wysiwyg-toc'
    this.dom.setAttribute('aria-label', '目录')
    this.dom.contentEditable = 'false'
    this.dom.addEventListener('click', this.onClick)
    const tocViews = tocViewsByEditor.get(view) ?? new Set<WysiwygTocView>()
    tocViews.add(this)
    tocViewsByEditor.set(view, tocViews)
    this.refresh()
  }

  refresh(): void {
    const headings = collectWysiwygTocHeadings(this.view.state.doc)
    const signature = headings
      .map((heading) => `${heading.level}:${heading.position}:${heading.text}`)
      .join('\n')
    if (signature === this.signature) return
    this.signature = signature

    const list = document.createElement('ol')
    headings.forEach((heading) => {
      const item = document.createElement('li')
      item.className = `markdown-toc-level-${heading.level}`
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'markdown-toc-link'
      button.dataset.position = String(heading.position)
      button.textContent = heading.text
      item.appendChild(button)
      list.appendChild(item)
    })
    this.dom.replaceChildren(list)
  }

  update(node: ProseMirrorNode): boolean {
    if (node.type.name !== 'toc') return false
    this.refresh()
    return true
  }

  stopEvent(event: Event): boolean {
    return event.target instanceof Node && this.dom.contains(event.target)
  }

  ignoreMutation(_mutation: ViewMutationRecord): boolean {
    return true
  }

  destroy(): void {
    const tocViews = tocViewsByEditor.get(this.view)
    tocViews?.delete(this)
    if (tocViews?.size === 0) tocViewsByEditor.delete(this.view)
    this.dom.removeEventListener('click', this.onClick)
  }
}

export const tocNodeView = $view(tocNode, () => (_node, view) => new WysiwygTocView(view))

export const tocRefreshPlugin = $prose(
  () =>
    new Plugin({
      view: (editorView) => ({
        update: (view, previousState) => {
          if (view.state.doc === previousState.doc) return
          tocViewsByEditor.get(editorView)?.forEach((tocView) => tocView.refresh())
        },
      }),
    }),
)
