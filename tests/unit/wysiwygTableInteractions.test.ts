import { Schema } from '@milkdown/kit/prose/model'
import { TextSelection } from '@milkdown/kit/prose/state'
import { CellSelection } from '@milkdown/kit/prose/tables'
import { describe, expect, it, vi } from 'vitest'
import {
  isTableCellSelection,
  placeTableCaretFromPointer,
} from '../../src/renderer/src/components/editor/wysiwygTableInteractions'

const schema = new Schema({
  nodes: {
    doc: { content: 'paragraph+' },
    paragraph: { content: 'text*' },
    text: { inline: true },
  },
})

describe('WYSIWYG table interactions', () => {
  it('recognizes an existing multi-cell selection without collapsing it to one column', () => {
    expect(isTableCellSelection(Object.create(CellSelection.prototype))).toBe(true)
    expect(isTableCellSelection(TextSelection.create(schema.node('doc', null, [schema.node('paragraph')]), 1))).toBe(false)
  })

  it('places a text caret on the first plain pointer press inside a table cell', () => {
    const doc = schema.node('doc', null, [schema.node('paragraph', null, schema.text('cell'))])
    const td = document.createElement('td')
    const span = document.createElement('span')
    td.appendChild(span)
    const dispatch = vi.fn()
    const view = {
      state: { doc, tr: { setSelection: vi.fn((selection) => ({ selection })) } },
      posAtCoords: vi.fn(() => ({ pos: 2, inside: 1 })),
      dispatch,
    }
    const event = new PointerEvent('pointerdown', { button: 0, clientX: 10, clientY: 12 })
    Object.defineProperty(event, 'target', { value: span })

    expect(placeTableCaretFromPointer(view as never, event)).toBe(true)
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ selection: expect.any(TextSelection) }))
  })
})
