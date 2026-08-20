import { useEffect, useState } from 'react'

interface UnsavedChangesDialogProps {
  visible: boolean
  fileName?: string | null
  onSave: () => void
  onDiscard: () => void
  onCancel: () => void
  isLoading?: boolean
}

/**
 * VS Code 风格的未保存文件确认对话框
 * 参考 VS Code 的 unsaved changes dialog
 */
export function UnsavedChangesDialog({
  visible,
  fileName,
  onSave,
  onDiscard,
  onCancel,
  isLoading = false,
}: UnsavedChangesDialogProps) {
  const [isVisible, setIsVisible] = useState(visible)

  useEffect(() => {
    setIsVisible(visible)
  }, [visible])

  useEffect(() => {
    if (!isVisible) return

    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onCancel()
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [isVisible, onCancel])

  if (!isVisible) return null

  return (
    <>
      {/* 半透明背景 */}
      <div
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.4)',
          zIndex: 9998,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
        onClick={onCancel}
      />

      {/* 对话框 */}
      <div
        style={{
          position: 'fixed',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          zIndex: 9999,
          background: 'var(--bg-card)',
          border: '1px solid var(--border-subtle)',
          borderRadius: 'var(--radius-lg)',
          boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
          minWidth: 360,
          maxWidth: 520,
          padding: 0,
          display: 'flex',
          flexDirection: 'column',
          fontFamily: 'var(--font-ui)',
          color: 'var(--text-primary)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* 标题区域 */}
        <div
          style={{
            padding: '20px 24px 12px',
          }}
        >
          <h2
            style={{
              margin: '0 0 12px 0',
              fontSize: 16,
              fontWeight: 600,
              color: 'var(--text-primary)',
            }}
          >
            保存
          </h2>
          <p
            style={{
              margin: '0 0 4px 0',
              fontSize: 13,
              color: 'var(--text-secondary)',
              lineHeight: 1.5,
            }}
          >
            是否保存更改?
          </p>
          <p
            style={{
              margin: 0,
              fontSize: 13,
              color: 'var(--text-secondary)',
              lineHeight: 1.5,
            }}
          >
            如果不保存，更改将永久丢失。
          </p>
        </div>

        {/* 按钮区域 */}
        <div
          style={{
            display: 'flex',
            gap: 8,
            padding: '12px 24px 20px',
            justifyContent: 'space-between',
          }}
        >
          <div style={{ display: 'flex', gap: 8 }}>
            {/* 保存按钮 — 主要操作 */}
            <button
              autoFocus
              onClick={onSave}
              disabled={isLoading}
              style={{
                padding: '8px 16px',
                borderRadius: 4,
                border: 'none',
                background: 'var(--accent)',
                color: '#FFFFFF',
                fontSize: 13,
                fontWeight: 500,
                fontFamily: 'var(--font-ui)',
                cursor: isLoading ? 'not-allowed' : 'pointer',
                opacity: isLoading ? 0.7 : 1,
                transition: 'opacity 150ms, background-color 150ms',
              }}
              onMouseEnter={(e) => {
                if (!isLoading) {
                  e.currentTarget.style.opacity = '0.9'
                }
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.opacity = '1'
              }}
            >
              {isLoading ? '保存中...' : '保存'}
            </button>

            {/* 不保存按钮 */}
            <button
              onClick={onDiscard}
              disabled={isLoading}
              style={{
                padding: '8px 16px',
                borderRadius: 4,
                border: '1px solid var(--border-visible)',
                background: 'var(--bg-secondary)',
                color: 'var(--text-secondary)',
                fontSize: 13,
                fontWeight: 500,
                fontFamily: 'var(--font-ui)',
                cursor: isLoading ? 'not-allowed' : 'pointer',
                opacity: isLoading ? 0.6 : 1,
                transition: 'background-color 150ms, color 150ms',
              }}
              onMouseEnter={(e) => {
                if (!isLoading) {
                  e.currentTarget.style.background = 'var(--hover)'
                }
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'var(--bg-secondary)'
              }}
            >
              不保存
            </button>
          </div>

          {/* 取消按钮 */}
          <button
            onClick={onCancel}
            disabled={isLoading}
            style={{
              padding: '8px 16px',
              borderRadius: 4,
              border: '1px solid var(--border-visible)',
              background: 'transparent',
              color: 'var(--text-secondary)',
              fontSize: 13,
              fontWeight: 500,
              fontFamily: 'var(--font-ui)',
              cursor: isLoading ? 'not-allowed' : 'pointer',
              opacity: isLoading ? 0.6 : 1,
              transition: 'background-color 150ms, color 150ms',
            }}
            onMouseEnter={(e) => {
              if (!isLoading) {
                e.currentTarget.style.background = 'var(--hover)'
              }
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent'
            }}
          >
            取消
          </button>
        </div>
      </div>
    </>
  )
}
