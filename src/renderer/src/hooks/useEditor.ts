import { useCallback, useMemo } from 'react'
import { json } from '@codemirror/lang-json'
import { markdown } from '@codemirror/lang-markdown'
import { search, highlightSelectionMatches } from '@codemirror/search'
import { EditorView, keymap, lineNumbers, highlightActiveLine } from '@codemirror/view'
import { defaultKeymap } from '@codemirror/commands'
import type { Extension } from '@codemirror/state'
import { fluxSyntaxHighlighting } from '../editor/codemirror/fluxSyntaxHighlight'
import { getLanguageExtensionsForPath } from '../editor/codemirror/languageFromPath'
import { logLineColoring } from '../editor/codemirror/logLineColoring'
import { useEditorStore } from '../stores/editorStore'
import type { EditorMode } from '../stores/editorStore'
import { useFileStore } from '../stores/fileStore'

// 隐藏原生搜索面板 UI，但保留搜索状态、高亮和 findNext/findPrevious 等命令支持
const hiddenSearchPanel = search({
  createPanel: () => {
    const dom = document.createElement('div')
    dom.style.display = 'none'
    return { dom }
  },
})

const baseExtensions: Extension[] = [
  EditorView.lineWrapping,
  lineNumbers(),
  highlightActiveLine(),
  highlightSelectionMatches(),
  hiddenSearchPanel,
  keymap.of([...defaultKeymap]),
]

function languageExtensionsForMode(mode: EditorMode, currentFile: string | null): Extension[] {
  switch (mode) {
    case 'json':
      return [json()]
    case 'markdown':
      return [markdown()]
    case 'log':
      return []
    case 'text':
    default:
      return getLanguageExtensionsForPath(currentFile)
  }
}

function isLogFile(path: string | null): boolean {
  return !!path && path.toLowerCase().endsWith('.log')
}

function isTxtFile(path: string | null): boolean {
  return !!path && path.toLowerCase().endsWith('.txt')
}

function isLikelyLogText(content: string): boolean {
  if (!content) return false

  // Keep detection cheap: sample only the head of the document.
  const sample = content.slice(0, 12000)
  let score = 0

  // Level keywords in common formats: [INFO], ]INFO, TRACE, ERROR, etc.
  if (/(\[(TRACE|DEBUG|INFO|WARN|WARNING|ERROR|FATAL|CRITICAL)\])|\](TRACE|DEBUG|INFO|WARN|WARNING|ERROR|FATAL|CRITICAL)\b/i.test(sample)) {
    score += 2
  }

  // Typical timestamp prefixes: 2026-03-27 13:48:55 or ISO-like variants.
  if (/\b\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}\b/.test(sample)) {
    score += 1
  }

  // Common runtime/log tokens seen in service logs.
  if (/\b(tid:\d+|thread|initialize|rpc|server)\b/i.test(sample)) {
    score += 1
  }

  return score >= 2
}

export function useEditor() {
  const mode = useEditorStore((s) => s.mode)
  const content = useEditorStore((s) => s.content)
  const currentFile = useFileStore((s) => s.currentFile)
  const setContent = useEditorStore((s) => s.setContent)

  const extensions = useMemo(() => {
    const lang = languageExtensionsForMode(mode, currentFile)
    const enableLogColors = isLogFile(currentFile) || (isTxtFile(currentFile) && isLikelyLogText(content))
    const logColors = enableLogColors ? [logLineColoring] : []
    return [...baseExtensions, ...lang, ...logColors, fluxSyntaxHighlighting]
  }, [mode, currentFile, content])

  const handleChange = useCallback(
    (value: string) => {
      setContent(value)
    },
    [setContent],
  )

  return { extensions, handleChange } as const
}
