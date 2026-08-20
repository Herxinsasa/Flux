import { useEffect } from 'react'
import { useFileStore } from '../stores/fileStore'
import { useChatStore } from '../stores/chatStore'
import { useEditorStore } from '../stores/editorStore'
import { useLayoutStore } from '../stores/layoutStore'
import { DEFAULT_READING_PREFERENCES, useSettingsStore } from '../stores/settingsStore'
import { saveActiveDocument } from '../utils/documentSave'

export { getSaveErrorMessage, saveActiveDocument } from '../utils/documentSave'

export type MarkdownZoomAction = 'in' | 'out' | 'reset'

const MARKDOWN_ZOOM_MIN = 12
const MARKDOWN_ZOOM_MAX = 24
const MARKDOWN_ZOOM_DEFAULT = DEFAULT_READING_PREFERENCES.bodyFontSize

function codeFontSizeForBodyFontSize(bodyFontSize: number): number {
  const offset = DEFAULT_READING_PREFERENCES.bodyFontSize - DEFAULT_READING_PREFERENCES.codeFontSize
  return Math.min(22, Math.max(11, bodyFontSize - offset))
}

export function getMarkdownZoomAction(event: Pick<KeyboardEvent, 'ctrlKey' | 'metaKey' | 'key'>): MarkdownZoomAction | null {
  if (!event.ctrlKey && !event.metaKey) return null
  if (event.key === '+' || event.key === '=') return 'in'
  if (event.key === '-') return 'out'
  if (event.key === '0') return 'reset'
  return null
}

export function getMarkdownZoomPercent(): number {
  const preferences = useSettingsStore.getState().readingPreferences
  return Math.round((preferences.bodyFontSize / MARKDOWN_ZOOM_DEFAULT) * 100)
}

export function applyMarkdownZoomAction(action: MarkdownZoomAction): void {
  const settings = useSettingsStore.getState()
  const current = settings.readingPreferences.bodyFontSize
  const next = action === 'reset'
    ? MARKDOWN_ZOOM_DEFAULT
    : Math.min(MARKDOWN_ZOOM_MAX, Math.max(MARKDOWN_ZOOM_MIN, current + (action === 'in' ? 1 : -1)))
  settings.setReadingPreferences({
    bodyFontSize: next,
    codeFontSize: codeFontSizeForBodyFontSize(next),
  })
}

export function useShortcuts() {
  const openFile = useFileStore((s) => s.openFile)
  const cancelAgent = useChatStore((s) => s.cancelAgent)

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.isComposing) return
      const mod = e.ctrlKey || e.metaKey

      if (mod && e.key === 'Tab') {
        e.preventDefault()
        e.stopPropagation()
        useFileStore.getState().cycleMru(e.shiftKey ? -1 : 1)
        return
      }

      const markdownZoomAction = getMarkdownZoomAction(e)
      if (markdownZoomAction && useEditorStore.getState().mode === 'markdown') {
        const markdownEditor = document.querySelector('.markdown-editor-container')
        const target = e.target instanceof Node ? e.target : document.activeElement
        if (markdownEditor && target && markdownEditor.contains(target)) {
          e.preventDefault()
          e.stopPropagation()
          applyMarkdownZoomAction(markdownZoomAction)
          return
        }
      }

      // Ctrl+O — 打开文件（Ctrl+N 预留给后续 untitled 新建文档）
      if (mod && e.key.toLowerCase() === 'o') {
        e.preventDefault()
        openFile()
        return
      }

      // Ctrl+/ — Markdown：预览 ↔ 源码（兼容实体 Slash 键与部分键盘 layout；mode 未同步时按扩展名兜底）
      if (mod && e.shiftKey && e.key.toLowerCase() === 'l') {
        e.preventDefault()
        useLayoutStore.getState().toggleMinimalMode()
        return
      }

      if (mod && (e.code === 'Slash' || e.key === '/')) {
        e.preventDefault()
        e.stopPropagation()
        useLayoutStore.getState().toggleChat()
        return
      }

      // Ctrl+S — 保存当前编辑器内容到磁盘（capture 优先于 contenteditable，避免被浏览器「保存网页」吃掉）
      if (mod && e.key.toLowerCase() === 's') {
        e.preventDefault()
        e.stopPropagation()
        void saveActiveDocument()
        return
      }

      // Alt+K — 将编辑器选区写入对话引用（需在编辑器区域内）
      if (e.altKey && !mod && e.key.toLowerCase() === 'k') {
        const pane = document.querySelector('.editor-pane-container')
        const ae = document.activeElement
        if (pane && ae && pane.contains(ae)) {
          const sel = useEditorStore.getState().selectedText
          if (sel) {
            e.preventDefault()
            const currentPath = useFileStore.getState().currentFile
            const sourceLabel = currentPath
              ? currentPath.split(/[/\\]/).pop() ?? currentPath
              : undefined
            const lineRange = useEditorStore.getState().selectedLineRange
            useChatStore.getState().appendQuote({
              text: sel,
              range: lineRange,
              sourceLabel,
            })
          }
        }
        return
      }

      // Escape — 仅在有 Agent 任务时取消，避免占用输入框 Esc
      if (e.key === 'Escape') {
        const st = useChatStore.getState().agentStatus
        if (st !== 'idle') {
          e.preventDefault()
          cancelAgent()
        }
        return
      }
    }

    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [openFile, cancelAgent])
}
