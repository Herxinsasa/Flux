import { useFileStore } from '../stores/fileStore'
import { getEditorComponent } from './editorModeRegistry'
import { EditorPane } from '../components/editor/EditorPane'
// Side-effect import: registers all built-in modes
import './builtinModes'

export function EditorRouter() {
  const currentFile = useFileStore((s) => s.currentFile)

  // Extract file extension from the current file path
  let ext = ''
  if (currentFile) {
    const dotIndex = currentFile.lastIndexOf('.')
    if (dotIndex >= 0) {
      ext = currentFile.slice(dotIndex).toLowerCase()
    }
  }

  const Component = ext ? getEditorComponent(ext) : undefined

  if (Component) {
    return <Component />
  }

  // Fallback: plain text editor for unregistered extensions or no file open
  return <EditorPane />
}
