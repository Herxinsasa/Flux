import { useCallback, useLayoutEffect, useRef, useState } from 'react'

interface WysiwygReviewComposerProps {
  x: number
  y: number
  onCancel: () => void
  onSave: (body: string) => Promise<boolean>
}

export function WysiwygReviewComposer({ x, y, onCancel, onSave }: WysiwygReviewComposerProps) {
  const [body, setBody] = useState('')
  const [saving, setSaving] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  // 默认在光标下方展开；实测超出视口底部时向上翻转，保证气泡完整可见不被遮挡
  const [flipUp, setFlipUp] = useState(false)

  const measure = useCallback(() => {
    const el = containerRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    setFlipUp((current) => {
      const next = rect.bottom > window.innerHeight - 8
      return next === current ? current : next
    })
  }, [])

  useLayoutEffect(() => {
    // 首次定位不钳制底部（可能出现越界），paint 前测量并翻转，用户无感知
    measure()
  }, [measure])

  useLayoutEffect(() => {
    // 窗口缩放时重算翻转状态
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [measure])

  const style: React.CSSProperties = flipUp
    ? {
        left: Math.max(8, Math.min(x, window.innerWidth - 300)),
        bottom: Math.max(8, window.innerHeight - y),
      }
    : {
        left: Math.max(8, Math.min(x, window.innerWidth - 300)),
        top: Math.max(8, y),
      }

  return (
    <div ref={containerRef} className="review-composer" style={style}>
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
