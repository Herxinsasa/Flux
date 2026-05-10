import { useEffect } from 'react'
import { useFileStore } from '../stores/fileStore'
import { useChatStore } from '../stores/chatStore'
import { useEditorStore } from '../stores/editorStore'

export function useShortcuts() {
  const openFile = useFileStore((s) => s.openFile)
  const cancelAgent = useChatStore((s) => s.cancelAgent)

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.isComposing) return
      const mod = e.ctrlKey || e.metaKey

      // Ctrl+O — 打开文件（Ctrl+N 预留给后续 untitled 新建文档）
      if (mod && e.key.toLowerCase() === 'o') {
        e.preventDefault()
        openFile()
        return
      }

      // Ctrl+/ — Markdown：预览 ↔ 源码（兼容实体 Slash 键与部分键盘 layout；mode 未同步时按扩展名兜底）
      if (mod && (e.code === 'Slash' || e.key === '/')) {
        const mode = useEditorStore.getState().mode
        const path = useFileStore.getState().currentFile
        const looksMd =
          mode === 'markdown' || (path != null && /\.(md|mdx|markdown)$/i.test(path))
        if (looksMd) {
          e.preventDefault()
          e.stopPropagation()
          useEditorStore.getState().toggleMarkdownEditSurface()
        }
        return
      }

      // Ctrl+S — 保存当前编辑器内容到磁盘（capture 优先于 contenteditable，避免被浏览器「保存网页」吃掉）
      if (mod && e.key.toLowerCase() === 's') {
        e.preventDefault()
        e.stopPropagation()
        const currentFile = useFileStore.getState().currentFile
        const content = useEditorStore.getState().content
        if (!currentFile) return
        void window.electronAPI.file.write(currentFile, content).then((res: { success?: boolean }) => {
          if (res?.success) {
            useEditorStore.getState().markClean()
          } else {
            console.error('Save failed')
          }
        })
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
