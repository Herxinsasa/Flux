import { Pin, X } from 'lucide-react'
import { useSessionContextStore } from '../../stores/sessionContextStore'
import { useFileStore } from '../../stores/fileStore'

interface PinnedFactsBarProps {
  onPersistHint?: (message: string) => void
}

export function PinnedFactsBar({ onPersistHint }: PinnedFactsBarProps) {
  const pinnedFacts = useSessionContextStore((s) => s.pinnedFacts)
  const unpinFact = useSessionContextStore((s) => s.unpinFact)
  const persistWorkspaceSession = useSessionContextStore((s) => s.persistWorkspaceSession)
  const workspaceRoot = useFileStore((s) => s.workspaceRoot)

  if (pinnedFacts.length === 0) return null

  const handleUnpin = (index: number) => {
    unpinFact(index)
    if (workspaceRoot) {
      void persistWorkspaceSession(workspaceRoot).then((ok) => {
        if (ok) onPersistHint?.('已更新工作区 session-summary')
      })
    }
  }

  return (
    <div
      className="flux-scroll"
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: 6,
        padding: '6px 10px',
        borderTop: '1px solid var(--border-subtle)',
        background: 'var(--bg-primary)',
        maxHeight: 72,
        overflowY: 'auto',
      }}
    >
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 4,
          fontSize: 11,
          color: 'var(--text-hint)',
          fontFamily: 'var(--font-ui)',
          marginRight: 4,
        }}
      >
        <Pin size={12} aria-hidden />
        已钉住
      </span>
      {pinnedFacts.map((fact, i) => (
        <span
          key={`pin-${i}`}
          title={fact}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            maxWidth: 220,
            padding: '2px 8px',
            borderRadius: 'var(--radius-sm)',
            border: '1px solid var(--border-visible)',
            background: 'var(--bg-card)',
            fontSize: 11,
            color: 'var(--text-secondary)',
            fontFamily: 'var(--font-ui)',
          }}
        >
          <span
            style={{
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {fact}
          </span>
          <button
            type="button"
            onClick={() => handleUnpin(i)}
            aria-label="取消钉住"
            style={{
              border: 'none',
              background: 'transparent',
              padding: 0,
              cursor: 'pointer',
              color: 'var(--text-hint)',
              display: 'inline-flex',
            }}
          >
            <X size={12} />
          </button>
        </span>
      ))}
    </div>
  )
}
