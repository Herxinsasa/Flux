import { Schema } from '@milkdown/kit/prose/model'
import { EditorState, TextSelection, type Transaction } from '@milkdown/kit/prose/state'
import { describe, expect, it, vi } from 'vitest'

import {
  createTaskMarkerTransaction,
  isTaskCheckboxHit,
  isTaskListItem,
  normalizeEmptyTaskListItems,
  splitTaskListItem,
  toggleTaskListItem,
} from '../../src/renderer/src/components/editor/wysiwygTaskList'

const schema = new Schema({
  nodes: {
    doc: { content: 'bullet_list+' },
    text: { group: 'inline' },
    paragraph: { content: 'text*', group: 'block' },
    bullet_list: { content: 'list_item+' },
    list_item: {
      content: 'paragraph block*',
      attrs: { checked: { default: null } },
    },
  },
})

function listDocument(text: string, checked: boolean | null) {
  return schema.nodes.doc.create(null, schema.nodes.bullet_list.create(null, [
    schema.nodes.list_item.create({ checked }, schema.nodes.paragraph.create(null, text ? schema.text(text) : undefined)),
  ]))
}

function stateAtTextEnd(text: string, checked: boolean | null) {
  const doc = listDocument(text, checked)
  let paragraphPosition = 0
  doc.descendants((node, position) => {
    if (node.type.name === 'paragraph') paragraphPosition = position
  })
  return EditorState.create({
    doc,
    selection: TextSelection.create(doc, paragraphPosition + 1 + text.length),
  })
}

describe('wysiwygTaskList', () => {
  it('recognizes only GFM task list items', () => {
    const task = schema.nodes.list_item.create({ checked: false }, schema.nodes.paragraph.create())
    const normal = schema.nodes.list_item.create({ checked: null }, schema.nodes.paragraph.create())

    expect(isTaskListItem(task)).toBe(true)
    expect(isTaskListItem(normal)).toBe(false)
  })

  it('limits checkbox clicks to the leading checkbox area', () => {
    const element = document.createElement('li')
    vi.spyOn(element, 'getBoundingClientRect').mockReturnValue({
      left: 100,
      right: 400,
      top: 50,
      bottom: 90,
      width: 300,
      height: 40,
      x: 100,
      y: 50,
      toJSON: () => ({}),
    })

    expect(isTaskCheckboxHit(element, new MouseEvent('click', { clientX: 112, clientY: 60 }))).toBe(true)
    expect(isTaskCheckboxHit(element, new MouseEvent('click', { clientX: 180, clientY: 60 }))).toBe(false)
  })

  it('toggles the checked attribute through a document transaction', () => {
    const task = schema.nodes.list_item.create({ checked: false }, schema.nodes.paragraph.create())
    const transaction = {
      setNodeMarkup: vi.fn().mockReturnThis(),
    }
    const view = {
      state: { tr: transaction },
      dispatch: vi.fn(),
      focus: vi.fn(),
    }

    toggleTaskListItem(view as never, task, 0)

    expect(transaction.setNodeMarkup).toHaveBeenCalledWith(0, undefined, expect.objectContaining({ checked: true }))
    expect(view.dispatch).toHaveBeenCalledWith(transaction)
    expect(view.focus).toHaveBeenCalled()
  })

  it('normalizes an empty GFM task marker during Markdown parsing', () => {
    const tree = {
      type: 'root',
      children: [{
        type: 'list',
        children: [{
          type: 'listItem',
          checked: null,
          children: [{ type: 'paragraph', children: [{ type: 'text', value: '[ ]' }] }],
        }],
      }],
    }

    normalizeEmptyTaskListItems(tree)

    expect(tree.children[0].children[0].checked).toBe(false)
    expect(tree.children[0].children[0].children[0].children).toEqual([])
  })

  it('turns the closing bracket into an empty unchecked task item immediately', () => {
    const state = stateAtTextEnd('[ ', null)
    const transaction = createTaskMarkerTransaction(state, state.selection.from, state.selection.to, ']')

    expect(transaction).not.toBeNull()
    const next = state.apply(transaction!)
    const item = next.doc.firstChild?.firstChild
    expect(item?.attrs.checked).toBe(false)
    expect(item?.textContent).toBe('')
  })

  it('continues a task list with a new unchecked item on Enter', () => {
    const state = stateAtTextEnd('done', true)
    let next = state

    expect(splitTaskListItem(state, (transaction: Transaction) => {
      next = state.apply(transaction)
    })).toBe(true)

    const list = next.doc.firstChild
    expect(list?.childCount).toBe(2)
    expect(list?.child(0).attrs.checked).toBe(true)
    expect(list?.child(1).attrs.checked).toBe(false)
  })
})
