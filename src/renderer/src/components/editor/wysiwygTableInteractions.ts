import type { Selection } from '@milkdown/kit/prose/state'
import { TextSelection } from '@milkdown/kit/prose/state'
import { CellSelection } from '@milkdown/kit/prose/tables'
import type { EditorView } from '@milkdown/kit/prose/view'

export function isTableCellSelection(selection: Selection): selection is CellSelection {
  return selection instanceof CellSelection
}

/** Place a text caret before Milkdown's table node view turns the first click into a node selection. */
export function placeTableCaretFromPointer(view: EditorView, event: PointerEvent): boolean {
  if (event.button !== 0 || event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) return false
  const target = event.target
  if (!(target instanceof Element) || !target.closest('td, th')) return false

  const position = view.posAtCoords({ left: event.clientX, top: event.clientY })
  if (!position) return false
  const selection = TextSelection.near(view.state.doc.resolve(position.pos))
  view.dispatch(view.state.tr.setSelection(selection))
  return true
}
