import { useCallback, useLayoutEffect, useRef, useState } from 'react'

interface WysiwygReviewComposerProps {
  x: number
  y: number
  onCancel: () => void
  onSave: (body: string) => Promise<boolean>
}

export function clampReviewComposerPosition(
  x: number,
  y: number,
  width: number,
  height: number,
  viewportWidth: number,
  viewportHeight: number,
): { left: number; top: number } {
  const margin = 8
  return {
    left: Math.max(margin, Math.min(x, Math.max(margin, viewportWidth - width - margin))),
    top: Math.max(margin, Math.min(y, Math.max(margin, viewportHeight - height - margin))),
  }
}

export function WysiwygReviewComposer({ x, y, onCancel, onSave }: WysiwygReviewComposerProps) {
  const [body, setBody] = useState('')
  const [saving, setSaving] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState(() =>
    clampReviewComposerPosition(x, y, 300, 140, window.innerWidth, window.innerHeight),
  )

  const measure = useCallback(() => {
    const el = containerRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const next = clampReviewComposerPosition(x, y, rect.width, rect.height, window.innerWidth, window.innerHeight)
    setPosition((current) => current.left === next.left && current.top === next.top ? current : next)
  }, [x, y])

  useLayoutEffect(() => {
    measure()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
    if (containerRef.current) observer?.observe(containerRef.current)
    window.addEventListener('resize', measure)
    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [measure])

  return (
    <div ref={containerRef} className="review-composer" style={position}>
      <textarea
        autoFocus
        value={body}
        onChange={(event) => setBody(event.target.value)}
        placeholder="输入批注"
      />
      <div>
        <button type="button" className="review-composer-cancel" onClick={onCancel}>取消</button>
        <button
          type="button"
          className="review-composer-save"
          disabled={!body.trim() || saving}
          onClick={async () => {
            setSaving(true)
            if (!(await onSave(body))) setSaving(false)
          }}
        >
          {saving ? '保存中…' : '保存'}
        </button>
      </div>
    </div>
  )
}
