import { useFileStore } from '../stores/fileStore'
import { getEditorComponent } from './editorModeRegistry'
import { EditorPane } from '../components/editor/EditorPane'
import { LogViewer } from '../components/editor/LogViewer'
// Side-effect import: registers all built-in modes
import './builtinModes'

export type EditorRoute = 'markdown' | 'log' | 'text'

export function editorRouteForPath(filePath: string | null): EditorRoute {
  if (!filePath) return 'text'
  const lowerPath = filePath.toLowerCase()
  if (lowerPath.endsWith('.log')) return 'log'
  if (lowerPath.endsWith('.md') || lowerPath.endsWith('.markdown')) return 'markdown'
  return 'text'
}

export function EditorRouter() {
  const currentFile = useFileStore((s) => s.currentFile)
  const route = editorRouteForPath(currentFile)
  if (route === 'log') return <LogViewer />

  let ext = ''
  if (currentFile) {
    const dotIndex = currentFile.lastIndexOf('.')
    if (dotIndex >= 0) {
      ext = currentFile.slice(dotIndex).toLowerCase()
    }
  }

  const Component = ext ? getEditorComponent(ext) : undefined

  if (route === 'markdown' && Component) {
    return <Component />
  }

  // Fallback: plain text editor for unregistered extensions or no file open
  return <EditorPane />
}
