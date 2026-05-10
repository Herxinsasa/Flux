import { useEffect } from 'react'
import type { EditorView } from '@codemirror/view'
import { useEditorStore } from '../stores/editorStore'

/**
 * Syncs CodeMirror's selection state to the editor store so other UI
 * (e.g. status bar) can display selected-text information.
 *
 * CM6's highlightSelectionMatches() extension (already in baseExtensions)
 * handles the visual highlighting. This hook just exposes the selection
 * metadata to the rest of the app.
 */
export function useSelectionHighlight(editorView: EditorView | null) {
  const setSelectedText = useEditorStore((s) => s.setSelectedText)
  const setSelectedLineRange = useEditorStore((s) => s.setSelectedLineRange)

  useEffect(() => {
    if (!editorView) return

    const dom = editorView.dom
    let lastSelected = ''

    const handler = () => {
      const selection = editorView.state.selection.main
      if (selection.empty) {
        if (lastSelected !== '') {
          setSelectedText(null)
          setSelectedLineRange(null)
          lastSelected = ''
        }
        return
      }
      // Read the selected text directly from the document
      const text = editorView.state.sliceDoc(selection.from, selection.to)
      if (text !== lastSelected) {
        setSelectedText(text || null)
        if (text) {
          const startLine = editorView.state.doc.lineAt(selection.from).number
          const endLine = editorView.state.doc.lineAt(selection.to).number
          setSelectedLineRange({ startLine, endLine })
        } else {
          setSelectedLineRange(null)
        }
        lastSelected = text
      }
    }

    // Use 'mouseup' and 'keyup' as practical signals for selection changes.
    // CodeMirror fires its own selection update internally, but we hook the
    // DOM to avoid creating a CM6 StateField just for this.
    dom.addEventListener('mouseup', handler)
    dom.addEventListener('keyup', handler)

    return () => {
      dom.removeEventListener('mouseup', handler)
      dom.removeEventListener('keyup', handler)
    }
  }, [editorView, setSelectedText])
}
