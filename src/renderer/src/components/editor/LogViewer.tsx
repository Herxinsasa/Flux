import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso'
import { useLogParser, parseLogLine, type LogLine } from '../../hooks/useLogParser'
import { LogLine as LogLineView } from './LogLine'
import { useEditorStore } from '../../stores/editorStore'
import { useFileStore } from '../../stores/fileStore'

const LINE_CHUNK = 250
const PREFETCH_PADDING = 100

function IndexedLogList({
  filePath,
  totalLines,
}: {
  filePath: string
  totalLines: number
}) {
  const [lineTexts, setLineTexts] = useState<Map<number, string>>(() => new Map())
  const loadingRef = useRef<Set<string>>(new Set())
  const virtuosoRef = useRef<VirtuosoHandle>(null)

  const fetchRange = useCallback(
    async (startLine: number, endLine: number) => {
      if (endLine < startLine || totalLines <= 0) return
      const clampedStart = Math.max(1, startLine)
      const clampedEnd = Math.min(totalLines, endLine)
      const key = `${clampedStart}-${clampedEnd}`
      if (loadingRef.current.has(key)) return
      loadingRef.current.add(key)

      try {
        const res = (await window.electronAPI.log.readLines(
          filePath,
          clampedStart - 1,
          clampedEnd - clampedStart + 1,
        )) as { success?: boolean; data?: { lines?: string[]; startLine?: number } }
        if (res?.success && res.data?.lines) {
          const base = res.data.startLine ?? clampedStart
          setLineTexts((prev) => {
            const next = new Map(prev)
            res.data!.lines!.forEach((text, i) => {
              next.set(base + i, text)
            })
            return next
          })
        }
      } finally {
        loadingRef.current.delete(key)
      }
    },
    [filePath, totalLines],
  )

  useEffect(() => {
    setLineTexts(new Map())
    loadingRef.current.clear()
    void fetchRange(1, Math.min(LINE_CHUNK, totalLines))
  }, [filePath, totalLines, fetchRange])

  const getLine = useCallback(
    (lineNumber: number): LogLine => {
      const text = lineTexts.get(lineNumber)
      if (text === undefined) {
        return { index: lineNumber, text: '…', level: null, color: null }
      }
      return parseLogLine(text, lineNumber)
    },
    [lineTexts],
  )

  const handleRangeChanged = useCallback(
    (startIndex: number, endIndex: number) => {
      const from = Math.max(1, startIndex + 1 - PREFETCH_PADDING)
      const to = Math.min(totalLines, endIndex + 1 + PREFETCH_PADDING)
      void fetchRange(from, to)
    },
    [fetchRange, totalLines],
  )

  const banner = useMemo(
    () => (
      <div
        className="text-[11px] text-[var(--text-hint)] px-2 py-1 border-b border-[var(--border-subtle)] shrink-0"
        style={{ fontFamily: 'var(--font-ui)' }}
      >
        大日志索引视图 · 共 {totalLines.toLocaleString()} 行 · 滚动时按需加载
      </div>
    ),
    [totalLines],
  )

  if (totalLines <= 0) {
    return (
      <div className="log-viewer-container flex-1 min-h-0">
        <div className="log-viewer-empty">无法读取日志行数</div>
      </div>
    )
  }

  return (
    <div className="log-viewer-container flex-1 min-h-0 flex flex-col">
      {banner}
      <Virtuoso
        ref={virtuosoRef}
        style={{ flex: 1, minHeight: 0 }}
        totalCount={totalLines}
        itemContent={(index) => <LogLineView item={getLine(index + 1)} />}
        rangeChanged={handleRangeChanged}
        increaseViewportBy={{ top: 200, bottom: 200 }}
        initialTopMostItemIndex={0}
      />
    </div>
  )
}

export function LogViewer() {
  const content = useEditorStore((s) => s.content)
  const logIndexedPath = useEditorStore((s) => s.logIndexedPath)
  const logTotalLines = useEditorStore((s) => s.logTotalLines)
  const currentFile = useFileStore((s) => s.currentFile)
  const isLoading = useFileStore((s) => s.isLoading)
  const currentFileName = useFileStore((s) => {
    const f = s.files.find((x) => x.path === s.currentFile)
    return f?.name ?? (s.currentFile ? s.currentFile.split(/[/\\]/).pop() : null)
  })

  const isIndexedView = Boolean(
    currentFile && logIndexedPath === currentFile && logTotalLines > 0,
  )

  const parsedLines = useLogParser(isIndexedView ? '' : content)

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

  if (isIndexedView && currentFile) {
    return (
      <div className="flex flex-col h-full min-h-0 overflow-hidden bg-[var(--bg-viewer)]">
        {chrome}
        {isLoading ? (
          <div className="log-viewer-container flex-1 min-h-0">
            <div className="log-viewer-empty">正在加载日志索引…</div>
          </div>
        ) : (
          <IndexedLogList filePath={currentFile} totalLines={logTotalLines} />
        )}
      </div>
    )
  }

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
          itemContent={(index) => <LogLineView item={parsedLines[index]} />}
          increaseViewportBy={{ top: 200, bottom: 200 }}
          followOutput={'smooth'}
          initialTopMostItemIndex={0}
        />
      </div>
    </div>
  )
}
