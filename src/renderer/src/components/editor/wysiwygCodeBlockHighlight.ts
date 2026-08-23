import hljs from 'highlight.js'
import { $prose } from '@milkdown/utils'
import type { Node as ProseMirrorNode } from '@milkdown/prose/model'
import { Plugin, PluginKey, type Transaction } from '@milkdown/prose/state'
import { Decoration, DecorationSet } from '@milkdown/prose/view'
import { isMermaidLanguage } from './mermaidCodeBlockView'

export interface CodeHighlightSpan {
  from: number
  to: number
  classes: string
}

function normalizedLanguage(language: unknown): string {
  return typeof language === 'string' ? language.trim().split(/\s+/)[0]?.toLowerCase() ?? '' : ''
}

/** Convert highlight.js HTML into text offsets so ProseMirror remains the editable DOM owner. */
export function highlightCodeText(code: string, language: unknown): CodeHighlightSpan[] {
  const normalized = normalizedLanguage(language)
  if (!code || !normalized || !hljs.getLanguage(normalized)) return []

  let value = ''
  try {
    value = hljs.highlight(code, { language: normalized, ignoreIllegals: true }).value
  } catch {
    return []
  }

  const container = document.createElement('code')
  container.innerHTML = value
  const spans: CodeHighlightSpan[] = []
  let offset = 0

  const visit = (node: Node, inherited: string[]) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const length = node.textContent?.length ?? 0
      if (length > 0 && inherited.length > 0) {
        spans.push({ from: offset, to: offset + length, classes: inherited.join(' ') })
      }
      offset += length
      return
    }
    if (!(node instanceof HTMLElement)) return
    const own = [...node.classList].filter((name) => name.startsWith('hljs-'))
    const classes = own.length > 0 ? [...new Set([...inherited, ...own])] : inherited
    node.childNodes.forEach((child) => visit(child, classes))
  }

  container.childNodes.forEach((node) => visit(node, []))
  return spans
}

function buildCodeDecorations(doc: ProseMirrorNode): DecorationSet {
  const decorations: Decoration[] = []
  doc.descendants((node, position) => {
    if (node.type.name !== 'code_block' || isMermaidLanguage(node.attrs.language)) return
    const language = normalizedLanguage(node.attrs.language)
    for (const span of highlightCodeText(node.textContent, language)) {
      decorations.push(Decoration.inline(position + 1 + span.from, position + 1 + span.to, {
        class: span.classes,
      }))
    }
  })
  return DecorationSet.create(doc, decorations)
}

function positionIsInCodeBlock(doc: ProseMirrorNode, position: number): boolean {
  const resolved = doc.resolve(Math.max(0, Math.min(position, doc.content.size)))
  for (let depth = resolved.depth; depth >= 0; depth -= 1) {
    if (resolved.node(depth).type.name === 'code_block') return true
  }
  return false
}

function rangeTouchesCodeBlock(doc: ProseMirrorNode, from: number, to: number): boolean {
  const start = Math.max(0, Math.min(from, doc.content.size))
  const end = Math.max(start, Math.min(to, doc.content.size))
  if (positionIsInCodeBlock(doc, start) || positionIsInCodeBlock(doc, end)) return true
  if (start === end) return false
  let touches = false
  doc.nodesBetween(start, end, (node) => {
    if (node.type.name === 'code_block') touches = true
    return !touches
  })
  return touches
}

/** Detect whether a transaction changed code-block content or attributes in the final document. */
export function transactionTouchesCodeBlock(transaction: Transaction): boolean {
  let touches = false
  transaction.mapping.maps.forEach((stepMap, index) => {
    if (touches) return
    const followingMaps = transaction.mapping.slice(index + 1)
    const oldDoc = transaction.docs[index] ?? transaction.before
    stepMap.forEach((oldFrom, oldTo, newFrom, newTo) => {
      if (touches) return
      if (rangeTouchesCodeBlock(oldDoc, oldFrom, oldTo)) {
        touches = true
        return
      }
      const finalFrom = followingMaps.map(newFrom, -1)
      const finalTo = followingMaps.map(newTo, 1)
      touches = rangeTouchesCodeBlock(transaction.doc, finalFrom, finalTo)
    })
  })
  return touches
}

const codeHighlightKey = new PluginKey<DecorationSet>('flux-wysiwyg-code-highlight')

export const wysiwygCodeBlockHighlight = $prose(() =>
  new Plugin<DecorationSet>({
    key: codeHighlightKey,
    state: {
      init: (_, state) => buildCodeDecorations(state.doc),
      apply: (transaction, previous) => {
        if (!transaction.docChanged) return previous
        const mapped = previous.map(transaction.mapping, transaction.doc)
        return transactionTouchesCodeBlock(transaction)
          ? buildCodeDecorations(transaction.doc)
          : mapped
      },
    },
    props: {
      decorations: (state) => codeHighlightKey.getState(state) ?? DecorationSet.empty,
    },
  }),
)
