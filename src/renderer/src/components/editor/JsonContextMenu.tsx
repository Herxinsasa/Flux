import { useEffect, useRef, useLayoutEffect, useState } from 'react'

interface JsonContextMenuProps {
  x: number
  y: number
  onClose: () => void
  onFormat: () => void
  onCompact: () => void
  error: string | null
  onClearError: () => void
  hasSelection?: boolean
  onQuote?: () => void
}

/**
 * Right-click context menu for JSON editor mode.
 *
 * When format/compact fails the error is shown as a toast inside the menu
 * and the menu itself stays open so the user can see the feedback.
 * Clicks outside the menu or pressing Escape dismiss it.
 */
export function JsonContextMenu({
  x,
  y,
  onClose,
  onFormat,
  onCompact,
  error,
  onClearError,
  hasSelection,
  onQuote,
}: JsonContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null)
  const [adjustedPos, setAdjustedPos] = useState<{ x: number; y: number } | null>(null)

  // Reposition the menu so it doesn't overflow the viewport.
  useLayoutEffect(() => {
    if (!menuRef.current) {
      setAdjustedPos({ x, y })
      return
    }
    const rect = menuRef.current.getBoundingClientRect()
    const vw = window.innerWidth
    const vh = window.innerHeight

    let ax = x
    let ay = y
    if (x + rect.width > vw) ax = vw - rect.width - 8
    if (y + rect.height > vh) ay = vh - rect.height - 8
    if (ax < 0) ax = 8

    setAdjustedPos({ x: ax, y: ay })
  }, [x, y])

  // Auto-dismiss error toast after 5 seconds.
  useEffect(() => {
    if (!error) return
    const timer = setTimeout(onClearError, 5000)
    return () => clearTimeout(timer)
  }, [error, onClearError])

  // Close on mousedown outside the menu.
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    // Small delay so the right-click event that opened the menu doesn't also close it.
    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handler)
    }, 0)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('mousedown', handler)
    }
  }, [onClose])

  // Close on Escape key.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  const handleFormat = () => {
    onFormat()
    onClose()
  }

  const handleCompact = () => {
    onCompact()
    onClose()
  }

  const handleQuote = () => {
    if (onQuote) {
      onQuote()
      onClose()
    }
  }

  return (
    <>
      {/* Invisible overlay — captures clicks outside, also blocks browser context-menu. */}
      <div
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          zIndex: 9999,
        }}
        onClick={onClose}
        onContextMenu={(e) => {
          e.preventDefault()
          onClose()
        }}
      />

      <div
        ref={menuRef}
        className="context-menu"
        style={{
          position: 'fixed',
          zIndex: 10000,
          ...(adjustedPos ? { left: adjustedPos.x, top: adjustedPos.y } : { left: x, top: y }),
        }}
      >
        {error && (
          <div
            className="context-menu-toast"
            role="alert"
          >
            <span className="context-menu-toast-text">{error}</span>
            <button
              className="context-menu-toast-dismiss"
              onClick={onClearError}
              aria-label="关闭"
            >
              ×
            </button>
          </div>
        )}

        <div
          className="context-menu-item"
          onClick={handleFormat}
          role="menuitem"
        >
          格式化 JSON
        </div>

        <div className="context-menu-separator" />

        <div
          className="context-menu-item"
          onClick={handleCompact}
          role="menuitem"
        >
          压缩 JSON
        </div>

        {hasSelection && onQuote && (
          <>
            <div className="context-menu-separator" />
            <div
              className="context-menu-item"
              onClick={handleQuote}
              role="menuitem"
            >
              引用到对话
            </div>
          </>
        )}
      </div>
    </>
  )
}
