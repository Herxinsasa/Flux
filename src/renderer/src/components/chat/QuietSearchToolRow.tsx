import type { ToolCallEntry } from '../../stores/chatStore'

interface QuietSearchToolRowProps {
  toolCall: ToolCallEntry
}

/**
 * search_content：不显式展示检索参数与命中结果，仅保留「检索中」状态（完成后条目可从列表省略）。
 */
export function QuietSearchToolRow({ toolCall }: QuietSearchToolRowProps) {
  const pending = toolCall.output === undefined

  if (!pending) {
    return null
  }

  return (
    <div className="agent-quiet-tool" role="status" aria-live="polite">
      <span className="agent-quiet-tool-dots" aria-hidden>
        <span />
        <span />
        <span />
      </span>
      <span className="agent-quiet-tool-label">正在检索代码库…</span>
    </div>
  )
}
