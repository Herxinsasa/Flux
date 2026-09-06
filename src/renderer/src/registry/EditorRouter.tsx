import { useEffect } from 'react'
import { useFileStore } from '../stores/fileStore'
import {
  READING_CODE_FONT_SIZE_MAX,
  READING_CODE_FONT_SIZE_MIN,
  useSettingsStore,
} from '../stores/settingsStore'
import { getEditorComponent } from './editorModeRegistry'
import { EditorPane } from '../components/editor/EditorPane'
import { LogViewer } from '../components/editor/LogViewer'
// Side-effect import: registers all built-in modes
import './builtinModes'

export type EditorRoute = 'markdown' | 'log' | 'text'

export function nextPlainTextFontSize(current: number, deltaY: number): number {
  const delta = deltaY < 0 ? 1 : -1
  return Math.min(
    READING_CODE_FONT_SIZE_MAX,
    Math.max(READING_CODE_FONT_SIZE_MIN, current + delta),
  )
}

export function editorRouteForPath(filePath: string | null): EditorRoute {
  if (!filePath) return 'text'
  const lowerPath = filePath.toLowerCase()
  if (lowerPath.endsWith('.log')) return 'log'
  if (lowerPath.endsWith('.md') || lowerPath.endsWith('.markdown')) return 'markdown'
  return 'text'
}

export function EditorRouter() {
  const currentFile = useFileStore((s) => s.currentFile)
  const setReadingPreferences = useSettingsStore((s) => s.setReadingPreferences)
  const route = editorRouteForPath(currentFile)

  useEffect(() => {
    if (route === 'markdown') return
    const handleWheel = (event: WheelEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.deltaY === 0) return
      const target = event.target
      if (
        !(target instanceof Element) ||
        !target.closest('.editor-pane-container, .log-viewer-container')
      )
        return
      event.preventDefault()
      const current = useSettingsStore.getState().readingPreferences.codeFontSize
      setReadingPreferences({ codeFontSize: nextPlainTextFontSize(current, event.deltaY) })
    }
    document.addEventListener('wheel', handleWheel, { passive: false })
    return () => document.removeEventListener('wheel', handleWheel)
  }, [route, setReadingPreferences])

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
