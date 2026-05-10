import { Virtuoso } from 'react-virtuoso'
import { useLogParser } from '../../hooks/useLogParser'
import { LogLine } from './LogLine'
import { useEditorStore } from '../../stores/editorStore'
import { useFileStore } from '../../stores/fileStore'

export function LogViewer() {
  const content = useEditorStore((s) => s.content)
  const isLoading = useFileStore((s) => s.isLoading)
  const currentFileName = useFileStore((s) => {
    const f = s.files.find((x) => x.path === s.currentFile)
    return f?.name ?? null
  })
  const parsedLines = useLogParser(content)

  // When content is empty and we are still loading, show a spinner.
  // When content is empty and loading is done, show a placeholder.
  const chrome = currentFileName ? (
    <div
      className="flex items-center gap-2 shrink-0 bg-[var(--bg-viewer)]"
      style={{ padding: '12px 8px' }}
    >
      <div
        className="flex items-center gap-1.5 rounded-[var(--radius-sm)] bg-[var(--bg-card)]"
        style={{ padding: '8px 6px' }}
      >
        <span
          className="font-[var(--font-mono)] text-[12px] leading-none font-normal text-[var(--accent)]"
        >
          {currentFileName}
        </span>
      </div>
    </div>
  ) : null

  if (!content && isLoading) {
    return (
      <div className="flex flex-col h-full min-h-0 overflow-hidden bg-[var(--bg-viewer)]">
        {chrome}
        <div className="log-viewer-container flex-1 min-h-0">
          <div className="log-viewer-empty">正在加载日志</div>
        </div>
      </div>
    )
  }

  if (!content) {
    return (
      <div className="flex flex-col h-full min-h-0 overflow-hidden bg-[var(--bg-viewer)]">
        {chrome}
        <div className="log-viewer-container flex-1 min-h-0">
          <div className="log-viewer-empty">请打开 .log 文件以查看日志</div>
        </div>
      </div>
    )
  }

  // No parsed lines — edge case for empty file
  if (parsedLines.length === 0) {
    return (
      <div className="flex flex-col h-full min-h-0 overflow-hidden bg-[var(--bg-viewer)]">
        {chrome}
        <div className="log-viewer-container flex-1 min-h-0">
          <div className="log-viewer-empty">空文件</div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full min-h-0 overflow-hidden bg-[var(--bg-viewer)]">
      {chrome}
      <div className="log-viewer-container flex-1 min-h-0">
      <Virtuoso
        style={{ height: '100%' }}
        totalCount={parsedLines.length}
        itemContent={(index) => <LogLine item={parsedLines[index]} />}
        // Pre-render rows outside the viewport to reduce blank flicker
        increaseViewportBy={{ top: 200, bottom: 200 }}
        // Auto-follow streaming output — scroll to bottom as new lines arrive
        followOutput={'smooth'}
        // Ensure the initial scroll position is at the top when opening a file
        initialTopMostItemIndex={0}
      />
      </div>
    </div>
  )
}
