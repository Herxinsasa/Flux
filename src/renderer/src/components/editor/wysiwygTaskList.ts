import type { Node as ProseMirrorNode } from '@milkdown/kit/prose/model'
import type { EditorView } from '@milkdown/kit/prose/view'
import { splitListItem } from '@milkdown/kit/prose/schema-list'
import { Plugin, PluginKey, type EditorState, type Transaction } from '@milkdown/kit/prose/state'
import { $prose, $remark } from '@milkdown/kit/utils'

const CHECKBOX_HIT_WIDTH = 26
const CHECKBOX_HIT_HEIGHT = 30
const taskInputPluginKey = new PluginKey<{ suppressSpaceAt: number } | null>('flux-task-list-input')

interface MarkdownAstNode {
  type: string
  value?: string
  checked?: boolean | null
  children?: MarkdownAstNode[]
}

function parentListItem(state: EditorState): { node: ProseMirrorNode; position: number } | null {
  const { $from } = state.selection
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    const node = $from.node(depth)
    if (node.type.name === 'list_item') return { node, position: $from.before(depth) }
  }
  return null
}

export function normalizeEmptyTaskListItems(tree: MarkdownAstNode): void {
  const visit = (node: MarkdownAstNode) => {
    if (node.type === 'listItem' && node.checked == null && node.children?.length === 1) {
      const paragraph = node.children[0]
      const marker = paragraph.type === 'paragraph' && paragraph.children?.length === 1
        ? paragraph.children[0]
        : null
      const match = marker?.type === 'text' ? /^\[([ xX])\]$/.exec(marker.value ?? '') : null
      if (match) {
        node.checked = match[1].toLowerCase() === 'x'
        paragraph.children = []
      }
    }
    node.children?.forEach(visit)
  }
  visit(tree)
}

export const emptyTaskListRemarkPlugin = $remark(
  'flux-empty-task-list',
  () => () => (tree: MarkdownAstNode) => normalizeEmptyTaskListItems(tree),
)

export function isTaskListItem(node: ProseMirrorNode): boolean {
  return node.type.name === 'list_item' && typeof node.attrs.checked === 'boolean'
}

export function isTaskCheckboxHit(element: HTMLElement, event: MouseEvent): boolean {
  const rect = element.getBoundingClientRect()
  return event.clientX >= rect.left
    && event.clientX <= rect.left + CHECKBOX_HIT_WIDTH
    && event.clientY >= rect.top
    && event.clientY <= rect.top + CHECKBOX_HIT_HEIGHT
}

export function toggleTaskListItem(view: EditorView, node: ProseMirrorNode, nodePosition: number): void {
  view.dispatch(view.state.tr.setNodeMarkup(nodePosition, undefined, {
    ...node.attrs,
    checked: !node.attrs.checked,
  }))
  view.focus()
}

export function createTaskMarkerTransaction(
  state: EditorState,
  from: number,
  to: number,
  text: string,
): Transaction | null {
  if (text !== ']' || !state.selection.empty) return null
  const item = parentListItem(state)
  if (!item || item.node.attrs.checked != null) return null

  const blockStart = state.selection.$from.start()
  const before = state.doc.textBetween(blockStart, from, '\n', '\n')
  const match = /^\[([ xX])$/.exec(before)
  if (!match) return null

  return state.tr
    .delete(from - before.length, to)
    .setNodeMarkup(item.position, undefined, {
      ...item.node.attrs,
      checked: match[1].toLowerCase() === 'x',
    })
}

export function splitTaskListItem(
  state: EditorState,
  dispatch?: (transaction: Transaction) => void,
): boolean {
  const item = parentListItem(state)
  if (!item || !isTaskListItem(item.node)) return false
  return splitListItem(item.node.type, {
    ...item.node.attrs,
    checked: false,
  })(state, dispatch)
}

export function createWysiwygTaskListPlugin(onToggle: () => void) {
  return $prose(() => new Plugin({
    key: taskInputPluginKey,
    state: {
      init: () => null,
      apply(transaction, previous) {
        const incoming = transaction.getMeta(taskInputPluginKey) as { suppressSpaceAt: number } | null | undefined
        if (incoming !== undefined) return incoming
        return transaction.docChanged || transaction.selectionSet ? null : previous
      },
    },
    props: {
      handleTextInput(view, from, to, text) {
        const pending = taskInputPluginKey.getState(view.state)
        if (pending && text === ' ' && from === pending.suppressSpaceAt && view.state.selection.$from.parent.content.size === 0) {
          view.dispatch(view.state.tr.setMeta(taskInputPluginKey, null))
          return true
        }

        const transaction = createTaskMarkerTransaction(view.state, from, to, text)
        if (!transaction) return false
        onToggle()
        transaction.setMeta(taskInputPluginKey, { suppressSpaceAt: from - 2 })
        view.dispatch(transaction)
        return true
      },
      handleKeyDown(view, event) {
        if (event.key !== 'Enter' || event.shiftKey || event.ctrlKey || event.altKey || event.metaKey || view.composing) return false
        const handled = splitTaskListItem(view.state, view.dispatch)
        if (handled) onToggle()
        return handled
      },
      handleClickOn(view, _position, node, nodePosition, event) {
        if (!isTaskListItem(node)) return false
        const element = view.nodeDOM(nodePosition)
        if (!(element instanceof HTMLElement) || !isTaskCheckboxHit(element, event)) return false
        event.preventDefault()
        onToggle()
        toggleTaskListItem(view, node, nodePosition)
        return true
      },
    },
  }))
}
