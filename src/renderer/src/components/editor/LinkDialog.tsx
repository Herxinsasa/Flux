import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react'

export interface LinkDialogValue {
  href: string
  text: string
}

export interface LinkDialogProps {
  open: boolean
  mode: 'insert' | 'edit'
  initialHref: string
  initialText: string
  onCancel: () => void
  onSubmit: (value: LinkDialogValue) => void
  /** 父组件提交失败时的提示；输入变化后由 onClearSubmitError 清除。 */
  submitError?: string
  onClearSubmitError?: () => void
}

/** 链接插入/编辑对话框，供 WYSIWYG 与 Markdown 源码两种编辑面共用。 */
export function LinkDialog({
  open,
  mode,
  initialHref,
  initialText,
  onCancel,
  onSubmit,
  submitError = '',
  onClearSubmitError,
}: LinkDialogProps) {
  const [href, setHref] = useState(initialHref)
  const [text, setText] = useState(initialText)
  const [error, setError] = useState('')
  const hrefRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    setHref(initialHref)
    setText(initialText)
    setError('')
    const frame = window.requestAnimationFrame(() => {
      hrefRef.current?.focus()
      hrefRef.current?.select()
    })
    return () => window.cancelAnimationFrame(frame)
  }, [open, initialHref, initialText])

  if (!open) return null

  const submit = () => {
    const nextHref = href.trim()
    const nextText = text.trim()
    if (!nextHref) {
      setError('请输入链接地址')
      return
    }
    if (!nextText) {
      setError('请输入显示文本')
      return
    }
    onSubmit({ href: nextHref, text: nextText })
  }

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      onCancel()
      return
    }
    if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
      // 按钮上的 Enter 交给按钮自身的 click 行为，避免“取消”被当成提交。
      if (event.target instanceof HTMLButtonElement) return
      event.preventDefault()
      event.stopPropagation()
      submit()
    }
  }

  const message = error || submitError

  return (
    <div
      className="flux-link-dialog-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel()
      }}
    >
      <div
        className="flux-link-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={mode === 'edit' ? '编辑链接' : '插入链接'}
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        <h2>{mode === 'edit' ? '编辑链接' : '插入链接'}</h2>
        <label>
          链接地址
          <input
            ref={hrefRef}
            value={href}
            placeholder="https://example.com 或 ./file.md"
            onChange={(event) => {
              setHref(event.target.value)
              setError('')
              onClearSubmitError?.()
            }}
          />
        </label>
        <label>
          显示文本
          <input
            value={text}
            placeholder="链接文本"
            onChange={(event) => {
              setText(event.target.value)
              setError('')
              onClearSubmitError?.()
            }}
          />
        </label>
        {message && (
          <p className="flux-link-dialog-error" role="alert">
            {message}
          </p>
        )}
        <div className="flux-link-dialog-actions">
          <button type="button" onClick={onCancel}>
            取消
          </button>
          <button type="button" className="primary" onClick={submit}>
            确定
          </button>
        </div>
      </div>
    </div>
  )
}
