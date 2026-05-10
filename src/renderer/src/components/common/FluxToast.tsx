import { useEffect } from 'react'
import { createPortal } from 'react-dom'

export type FluxToastVariant = 'success' | 'error'

export interface FluxToastState {
  message: string
  variant: FluxToastVariant
}

interface FluxToastProps {
  toast: FluxToastState | null
  onDismiss: () => void
}

/**
 * 全局统一的气泡提示：挂到 document.body，避免被父级 stacking / overflow 遮挡。
 */
export function FluxToast({ toast, onDismiss }: FluxToastProps) {
  useEffect(() => {
    if (!toast) return
    const t = window.setTimeout(onDismiss, 3800)
    return () => clearTimeout(t)
  }, [toast, onDismiss])

  if (!toast) return null

  const border =
    toast.variant === 'success'
      ? 'color-mix(in srgb, var(--success) 28%, var(--border-visible))'
      : 'color-mix(in srgb, var(--error) 28%, var(--border-visible))'

  const accent =
    toast.variant === 'success'
      ? 'color-mix(in srgb, var(--success) 55%, var(--text-tertiary))'
      : 'color-mix(in srgb, var(--error) 50%, var(--text-tertiary))'

  return createPortal(
    <div
      role="status"
      className="pointer-events-auto flux-scroll"
      style={{
        position: 'fixed',
        left: '50%',
        top: 12,
        transform: 'translateX(-50%)',
        zIndex: 2147483000,
        maxWidth: 'min(420px, calc(100vw - 32px))',
        padding: '10px 14px',
        borderRadius: 'var(--radius-md)',
        background: 'color-mix(in srgb, var(--bg-card) 92%, var(--bg-primary))',
        border: `1px solid ${border}`,
        boxShadow: '0 6px 24px rgba(0,0,0,0.18)',
        fontFamily: 'var(--font-ui)',
        fontSize: 13,
        fontWeight: 400,
        lineHeight: 1.45,
        color: 'var(--text-secondary)',
      }}
    >
      <span style={{ color: accent, marginRight: 8 }} aria-hidden>
        {toast.variant === 'success' ? '✓' : '✕'}
      </span>
      {toast.message}
    </div>,
    document.body,
  )
}
