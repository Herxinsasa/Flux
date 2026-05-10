import { useState, useRef, useEffect } from 'react'
import type { ToolCallEntry } from '../../stores/chatStore'
import type { PreviewChangeData } from '../../hooks/useEditorChatBridge'

interface ToolCallCardProps {
  toolCall: ToolCallEntry
  previewMeta?: PreviewChangeData
  onApplyChange?: (changeId: string) => Promise<{ success: boolean; error?: string }>
  onRejectChange?: (changeId: string) => Promise<{ success: boolean; error?: string }>
}

interface WriteEdit {
  startLine: number
  endLine: number
  newText: string
}

/** Readable labels for built-in tool names */
const TOOL_LABELS: Record<string, string> = {
  read_file: '读取文件',
  write_file: '写入文件',
  search_content: '搜索内容',
  get_file_info: '获取文件信息',
}

function getWritePlanMeta(input: unknown, previewMeta?: PreviewChangeData): {
  filePath?: string
  addedLines: number
  deletedLines: number
  edits: WriteEdit[]
  oldTexts: string[]
} {
  const meta = {
    filePath: undefined as string | undefined,
    addedLines: 0,
    deletedLines: 0,
    edits: [] as WriteEdit[],
    oldTexts: [] as string[],
  }

  if (previewMeta) {
    meta.filePath = previewMeta.filePath
    meta.addedLines = previewMeta.addedLines
    meta.deletedLines = previewMeta.deletedLines
    meta.edits = previewMeta.diffBlocks.map((b) => ({
      startLine: b.startLine,
      endLine: b.endLine,
      newText: b.newText,
    }))
    meta.oldTexts = previewMeta.diffBlocks.map((b) => b.oldText)
    return meta
  }

  if (!input || typeof input !== 'object') return meta

  const row = input as Record<string, unknown>
  if (typeof row.filePath === 'string') meta.filePath = row.filePath

  if (Array.isArray(row.edits)) {
    const edits = row.edits
      .map((item) => {
        if (!item || typeof item !== 'object') return null
        const edit = item as Record<string, unknown>
        const start = Math.floor(Number(edit.startLine))
        const end = Math.floor(Number(edit.endLine))
        const newText = typeof edit.newText === 'string' ? edit.newText : ''
        if (!Number.isFinite(start) || !Number.isFinite(end)) return null
        const safeStart = Math.max(1, start)
        const safeEnd = Math.max(safeStart, end)
        return {
          startLine: safeStart,
          endLine: safeEnd,
          newText,
        }
      })
      .filter((e): e is WriteEdit => Boolean(e))

    meta.edits = edits
    meta.deletedLines = edits.reduce((acc, e) => acc + (e.endLine - e.startLine + 1), 0)
    meta.addedLines = edits.reduce((acc, e) => {
      if (!e.newText) return acc
      return acc + e.newText.split('\n').length
    }, 0)
    meta.oldTexts = edits.map(() => '')
  }

  return meta
}

function summarizeToolCall(toolCall: ToolCallEntry, outputText: string): string {
  if (!outputText) return '执行中...'

  if (toolCall.name === 'read_file') {
    const lineCount = outputText.split('\n').length
    const charCount = outputText.length
    return `已读取 ${lineCount} 行，${charCount} 字符`
  }

  return toolCall.isError ? '执行失败' : '执行完成'
}

function baseName(filePath?: string): string {
  if (!filePath) return '未命名文件'
  return filePath.split(/[/\\]/).pop() || filePath
}

function renderWriteDiffBlocks(writePlan: ReturnType<typeof getWritePlanMeta>) {
  if (writePlan.edits.length === 0) {
    return (
      <div className="tool-call-diff-block tool-call-diff-block--add">未提供可预览的补丁内容。</div>
    )
  }

  return writePlan.edits.map((edit, idx) => (
    <div className="tool-call-diff-group" key={`${edit.startLine}-${edit.endLine}-${idx}`}>
      {writePlan.oldTexts[idx] ? (
        <div className="tool-call-diff-block tool-call-diff-block--remove">
          {writePlan.oldTexts[idx]}
        </div>
      ) : null}
      <div className="tool-call-diff-block tool-call-diff-block--add">
        {edit.newText || '(空文本，表示仅删除)'}
      </div>
    </div>
  ))
}

export function ToolCallCard({ toolCall, previewMeta, onApplyChange, onRejectChange }: ToolCallCardProps) {
  const contentRef = useRef<HTMLDivElement>(null)
  const [contentHeight, setContentHeight] = useState(0)
  const [pendingAction, setPendingAction] = useState<'apply' | 'reject' | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const hasOutput = toolCall.output !== undefined
  const outputText = hasOutput
    ? typeof toolCall.output === 'string'
      ? toolCall.output
      : JSON.stringify(toolCall.output, null, 2)
    : ''

  const prefersCollapsedByDefault =
    toolCall.name === 'read_file' ||
    outputText.length > 280

  const outputSummary = summarizeToolCall(toolCall, outputText)
  const isReadOrWrite = toolCall.name === 'read_file' || toolCall.name === 'write_file'
  const isWriteCard = toolCall.name === 'write_file'
  const showInlineWriteActions = isWriteCard && !toolCall.isError && Boolean(onApplyChange)
  const writePlan = toolCall.name === 'write_file' ? getWritePlanMeta(toolCall.input, previewMeta) : null

  const [expanded, setExpanded] = useState(
    toolCall.name === 'write_file' ? false : !prefersCollapsedByDefault,
  )

  useEffect(() => {
    // Only reset when switching to another tool-call card. Keep user's manual toggle within same card.
    setExpanded(toolCall.name === 'write_file' ? false : !prefersCollapsedByDefault)
    setPendingAction(null)
    setActionError(null)
  }, [toolCall.id, toolCall.name])

  useEffect(() => {
    if (contentRef.current) {
      setContentHeight(contentRef.current.scrollHeight)
    }
  }, [toolCall.output])

  const label = TOOL_LABELS[toolCall.name] ?? toolCall.name

  // Format input for display
  let inputPreview = ''
  if (toolCall.input && typeof toolCall.input === 'object') {
    const inp = toolCall.input as Record<string, unknown>
    // Show first meaningful field
    if (inp.filePath) inputPreview = String(inp.filePath)
    else if (inp.pattern) inputPreview = String(inp.pattern)
    else if (inp.content) inputPreview = String(inp.content).slice(0, 60) + (String(inp.content).length > 60 ? '...' : '')
    else inputPreview = JSON.stringify(inp).slice(0, 80)
  } else if (typeof toolCall.input === 'string') {
    inputPreview = toolCall.input.slice(0, 80)
  }

  return (
    <div className="tool-call-card" data-error={toolCall.isError ? 'true' : undefined}>
      {/* Header — always visible */}
      <button
        className="tool-call-header"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
      >
        {/* Expand arrow */}
        <svg
          className={`tool-call-arrow ${expanded ? 'expanded' : ''}`}
          width="12"
          height="12"
          viewBox="0 0 12 12"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M3 5l3 3 3-3" />
        </svg>

        {/* Tool label + preview */}
        <span className="tool-call-label">{label}</span>
        {toolCall.name === 'write_file' && writePlan && (
          <span className="tool-call-preview">
            {`${baseName(writePlan.filePath)}  +${writePlan.addedLines}  -${writePlan.deletedLines}`}
          </span>
        )}
        {!isReadOrWrite && inputPreview && (
          <span className="tool-call-preview">{inputPreview}</span>
        )}
        {!isReadOrWrite && hasOutput && (
          <span className="tool-call-preview" title={outputSummary}>
            {outputSummary}
          </span>
        )}

        {/* Status indicator */}
        {!hasOutput && !showInlineWriteActions && (
          <span className="tool-call-spinner" />
        )}
        {toolCall.isError && (
          <span className="tool-call-error-dot" />
        )}

        {showInlineWriteActions && (
          <span className="tool-call-header-actions">
            <button
              type="button"
              className="tool-call-preview-btn tool-call-preview-btn-reject"
              disabled={pendingAction !== null}
              onClick={async (e) => {
                e.stopPropagation()
                if (!onRejectChange) return
                setActionError(null)
                setPendingAction('reject')
                const res = await onRejectChange(toolCall.id)
                if (!res.success) {
                  setActionError(res.error ?? '撤销失败')
                  setPendingAction(null)
                }
              }}
            >
              {pendingAction === 'reject' ? '撤销中...' : '撤销'}
            </button>
            <button
              type="button"
              className="tool-call-preview-btn tool-call-preview-btn-apply"
              disabled={pendingAction !== null}
              onClick={async (e) => {
                e.stopPropagation()
                if (!onApplyChange) return
                setActionError(null)
                setPendingAction('apply')
                const res = await onApplyChange(toolCall.id)
                if (!res.success) {
                  setActionError(res.error ?? '确认写入失败')
                  setPendingAction(null)
                }
              }}
            >
              {pendingAction === 'apply' ? '保留中...' : '保留'}
            </button>
          </span>
        )}
      </button>

      {/* Collapsible body */}
      <div
        className="tool-call-body"
        style={{
          maxHeight: expanded ? `${contentHeight}px` : '0px',
          opacity: expanded ? 1 : 0,
        }}
      >
        <div ref={contentRef} className="tool-call-body-inner">
          {toolCall.name === 'write_file' && writePlan && (
            <div className="tool-call-section">
              <span className="tool-call-section-label">{writePlan.filePath ?? '文件修改预览'}</span>
              <div className="tool-call-diff-list flux-scroll">
                {renderWriteDiffBlocks(writePlan)}
              </div>
            </div>
          )}

          {!isReadOrWrite && (
            <div className="tool-call-section">
              <span className="tool-call-section-label">输入</span>
              <pre className="tool-call-pre flux-scroll">
                {typeof toolCall.input === 'string'
                  ? toolCall.input
                  : JSON.stringify(toolCall.input, null, 2)}
              </pre>
            </div>
          )}

          {/* Output */}
          {hasOutput && toolCall.name !== 'write_file' && (
            <div className="tool-call-section">
              {!isReadOrWrite && (
                <span className="tool-call-section-label">
                  {toolCall.isError ? '错误' : '输出'}
                </span>
              )}
              <pre
                className={`tool-call-pre flux-scroll ${toolCall.isError ? 'tool-call-pre-error' : ''}`}
              >
                {outputText}
              </pre>
            </div>
          )}
        </div>
      </div>

      {actionError && (
        <div className="tool-call-body-inner" style={{ paddingTop: 0 }}>
          <div className="tool-call-pre tool-call-pre-error">{actionError}</div>
        </div>
      )}
    </div>
  )
}
