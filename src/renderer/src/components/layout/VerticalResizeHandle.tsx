import { useCallback, useRef } from 'react'

interface VerticalResizeHandleProps {
  /** 按下时调用，用于记录拖动起始宽度等 */
  onResizeStart: () => void
  /** 相对按下点的水平位移（向右为正） */
  onResize: (deltaXFromStart: number) => void
  onResizeEnd?: () => void
}

/**
 * 竖向分隔条（类似 VS Code 侧栏与编辑区之间的拖拽条）
 */
export function VerticalResizeHandle({ onResizeStart, onResize, onResizeEnd }: VerticalResizeHandleProps) {
  const startX = useRef(0)

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault()
      const el = e.currentTarget as HTMLElement
      el.setPointerCapture(e.pointerId)
      startX.current = e.clientX
      onResizeStart()

      const onMove = (ev: PointerEvent) => {
        onResize(ev.clientX - startX.current)
      }

      const onUp = (ev: PointerEvent) => {
        try {
          el.releasePointerCapture(ev.pointerId)
        } catch {
          /* ignore */
        }
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
        window.removeEventListener('pointercancel', onUp)
        onResizeEnd?.()
      }

      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
      window.addEventListener('pointercancel', onUp)
    },
    [onResize, onResizeStart, onResizeEnd],
  )

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="调整面板宽度"
      onPointerDown={onPointerDown}
      className="shrink-0 cursor-col-resize z-10 flex justify-center group"
      style={{ width: 6, marginLeft: -2, marginRight: -2 }}
    >
      <div className="w-px h-full bg-[var(--border-subtle)] group-hover:bg-[var(--accent)] transition-colors" />
    </div>
  )
}
