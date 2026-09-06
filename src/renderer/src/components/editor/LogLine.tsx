import { memo } from 'react'
import type { LogLine as LogLineData } from '../../hooks/useLogParser'

export interface LogLineProps {
  item: LogLineData
}

/**
 * Single log line rendered inside react-virtuoso.
 * Shows a line number gutter followed by the log text, colour-coded by severity.
 * Wrapped in React.memo to avoid re-renders during virtual scrolling.
 */
export const LogLine = memo(function LogLine({ item }: LogLineProps) {
  return (
    <div
      className="log-line"
      style={{
        display: 'flex',
        alignItems: 'baseline',
        fontFamily: 'var(--font-editor)',
        fontSize: 'calc(var(--font-code-size, 13px) + 3px)',
        lineHeight: 1.5,
      }}
    >
      <span
        className="log-line-number"
        style={{
          width: 52,
          textAlign: 'right',
          paddingRight: 8,
          paddingLeft: 12,
          color: 'var(--text-tertiary)',
          fontVariantNumeric: 'tabular-nums',
          userSelect: 'none',
          flexShrink: 0,
        }}
      >
        {item.index}
      </span>
      <span
        className="log-line-text"
        style={{
          color: 'var(--text-primary)',
          whiteSpace: 'pre',
        }}
      >
        {item.text}
      </span>
    </div>
  )
})
