import {
  MAX_REQUEST_INPUT_CHARS,
  WARN_INPUT_CHARS,
  estimateInputChars,
  type BudgetChatMessage,
} from '../../../../shared/context-budget'

interface ChatContextBarProps {
  history: BudgetChatMessage[]
  prefaceChars: number
  userMessageChars: number
  systemChars: number
  hasSummary: boolean
  isRunning: boolean
  isAutoCompressing?: boolean
}

export function ChatContextBar({
  history,
  prefaceChars,
  userMessageChars,
  systemChars,
  hasSummary,
  isRunning,
  isAutoCompressing = false,
}: ChatContextBarProps) {
  const estimate = estimateInputChars({
    system: 'x'.repeat(systemChars + (hasSummary ? 2000 : 0)),
    preface: prefaceChars > 0 ? 'x'.repeat(prefaceChars) : undefined,
    history,
    userMessage: 'x'.repeat(Math.max(1, userMessageChars)),
  })

  const pct = Math.min(100, Math.round((estimate.total / MAX_REQUEST_INPUT_CHARS) * 100))
  const level =
    estimate.total > MAX_REQUEST_INPUT_CHARS
      ? 'over'
      : estimate.total >= WARN_INPUT_CHARS
        ? 'warn'
        : 'ok'

  const barColor =
    level === 'over'
      ? 'var(--error)'
      : level === 'warn'
        ? 'var(--warning, #d4a017)'
        : 'var(--accent)'

  const kb = Math.round(estimate.total / 1024)
  const capKb = Math.round(MAX_REQUEST_INPUT_CHARS / 1024)

  return (
    <div
      className="chat-context-bar"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        padding: '6px 10px',
        borderTop: '1px solid var(--border-subtle)',
        background: 'var(--bg-primary)',
        fontFamily: 'var(--font-ui)',
        fontSize: 11,
        color: 'var(--text-hint)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div
          style={{
            flex: 1,
            height: 4,
            borderRadius: 2,
            background: 'var(--border-subtle)',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              width: `${pct}%`,
              height: '100%',
              background: barColor,
              transition: 'width 0.2s ease',
            }}
          />
        </div>
        <span style={{ whiteSpace: 'nowrap', color: level === 'ok' ? undefined : barColor }}>
          约 {kb} / {capKb} KB（≈{estimate.tokenEstimate.toLocaleString()} tokens）
        </span>
      </div>
      {isAutoCompressing && (
        <div
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            color: 'var(--warning, #d4a017)',
          }}
        >
          正在压缩上下文，暂不可发送…
        </div>
      )}
      {!isAutoCompressing && !isRunning && (
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          自动压缩已启用
        </div>
      )}
    </div>
  )
}
