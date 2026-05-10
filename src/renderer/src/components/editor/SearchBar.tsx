import { useState, useCallback, useEffect, useRef, useMemo, type CSSProperties, type ReactNode } from 'react'
import type { EditorView } from '@codemirror/view'
import {
  SearchQuery,
  setSearchQuery,
  findNext,
  findPrevious,
  closeSearchPanel,
  replaceNext,
  replaceAll,
} from '@codemirror/search'
import { useEditorStore } from '../../stores/editorStore'

interface SearchBarProps {
  editorView: EditorView | null
  visible: boolean
  onClose: () => void
}

/** 设计稿 O5pWYp：Find / Replace 输入槽 — viewer 底、圆角 6、内边距 6×10 */
function inputShellStyle(extra?: CSSProperties): CSSProperties {
  return {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '6px 10px',
    borderRadius: 6,
    background: 'var(--bg-viewer)',
    border: '1px solid transparent',
    minWidth: 0,
    ...extra,
  }
}

export function SearchBar({ editorView, visible, onClose }: SearchBarProps) {
  const [queryText, setQueryText] = useState('')
  const [replaceText, setReplaceText] = useState('')
  const [caseSensitive, setCaseSensitive] = useState(false)
  const [wholeWord, setWholeWord] = useState(false)
  const [regexEnabled, setRegexEnabled] = useState(false)
  const [matchIndex, setMatchIndex] = useState(0)
  const [matchTotal, setMatchTotal] = useState(0)
  const [regexError, setRegexError] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const docRevision = useEditorStore((s) => s.content.length)

  const query = useMemo(() => {
    if (!queryText) {
      setRegexError(false)
      return null
    }

    const q = new SearchQuery({
      search: queryText,
      replace: replaceText,
      regexp: regexEnabled,
      caseSensitive,
      wholeWord,
    })

    if (regexEnabled && !q.valid) {
      setRegexError(true)
      return null
    }

    setRegexError(false)
    return q
  }, [queryText, replaceText, regexEnabled, caseSensitive, wholeWord])

  useEffect(() => {
    if (!editorView || !query) return

    editorView.dispatch({
      effects: setSearchQuery.of(query),
    })

    const cursor = query.getCursor(editorView.state)
    let count = 0
    while (cursor.next()) count++
    setMatchTotal(count)
    setMatchIndex(count > 0 ? 1 : 0)
  }, [editorView, query, docRevision])

  useEffect(() => {
    if (visible && inputRef.current) {
      const timer = setTimeout(() => {
        inputRef.current?.focus()
        inputRef.current?.select()
      }, 50)
      return () => clearTimeout(timer)
    }
  }, [visible])

  useEffect(() => {
    if (!visible) return

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [visible, onClose])

  useEffect(() => {
    if (!editorView || !query || matchTotal === 0) return

    const update = () => {
      const sel = editorView.state.selection.main
      const cursor = query.getCursor(editorView.state)
      let idx = 0
      let next: IteratorResult<{ from: number; to: number }>
      while ((next = cursor.next()) && !next.done) {
        idx++
        const m = next.value
        if (sel.from <= m.to && sel.to >= m.from) {
          setMatchIndex(idx)
          return
        }
      }
    }

    const dom = editorView.dom
    dom.addEventListener('mouseup', update)
    dom.addEventListener('keyup', update)
    return () => {
      dom.removeEventListener('mouseup', update)
      dom.removeEventListener('keyup', update)
    }
  }, [editorView, query, matchTotal])

  const handleFindNext = useCallback(() => {
    if (!editorView || !query || !query.valid) return
    findNext(editorView)
  }, [editorView, query])

  const handleFindPrev = useCallback(() => {
    if (!editorView || !query || !query.valid) return
    findPrevious(editorView)
  }, [editorView, query])

  const handleReplaceOne = useCallback(() => {
    if (!editorView || !query || !query.valid) return
    replaceNext(editorView)
  }, [editorView, query])

  const handleReplaceAll = useCallback(() => {
    if (!editorView || !query || !query.valid) return
    replaceAll(editorView)
  }, [editorView, query])

  const handleClose = useCallback(() => {
    if (editorView) {
      closeSearchPanel(editorView)
    }
    setQueryText('')
    setReplaceText('')
    setCaseSensitive(false)
    setWholeWord(false)
    setRegexEnabled(false)
    setMatchTotal(0)
    setMatchIndex(0)
    setRegexError(false)
    onClose()
  }, [editorView, onClose])

  const matchDisplay = queryText ? `${matchTotal > 0 ? matchIndex : 0} / ${matchTotal}` : ''

  const monoInput: CSSProperties = {
    flex: 1,
    minWidth: 0,
    border: 'none',
    outline: 'none',
    background: 'transparent',
    fontFamily: 'var(--font-mono)',
    fontSize: 12,
    color: 'var(--text-primary)',
  }

  const optCheckbox = (checked: boolean, flip: () => void, label: ReactNode, title: string) => (
    <label
      title={title}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        cursor: 'pointer',
        userSelect: 'none',
        fontSize: 11,
        color: checked ? 'var(--text-secondary)' : 'var(--text-tertiary)',
        fontFamily: 'var(--font-ui)',
      }}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={() => flip()}
        style={{
          width: 14,
          height: 14,
          margin: 0,
          accentColor: 'var(--accent)',
          cursor: 'pointer',
        }}
      />
      {label}
    </label>
  )

  const findShellBorder =
    regexError && queryText ? ('1px solid var(--error)' as const) : '1px solid transparent'

  return (
    <div
      className="search-bar-container"
      style={{
        position: 'absolute',
        top: 8,
        left: 12,
        right: 12,
        zIndex: 20,
        transform: visible ? 'translateY(0)' : 'translateY(-100%)',
        opacity: visible ? 1 : 0,
        transition: 'transform 200ms ease-out, opacity 200ms ease-out',
        pointerEvents: visible ? 'auto' : 'none',
        background: 'var(--bg-card)',
        border: '1px solid var(--border-subtle)',
        borderRadius: 'var(--radius-md)',
        padding: '12px 16px',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        fontFamily: 'var(--font-ui)',
        fontSize: 13,
        color: 'var(--text-primary)',
        maxWidth: 'calc(100% - 24px)',
        boxSizing: 'border-box',
        boxShadow: '0 2px 12px rgba(0,0,0,0.12)',
      }}
    >
      {/* Find Row — giRvN 宽 520 + PeQao + MatchCount + WNKah */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          width: '100%',
          flexWrap: 'nowrap',
          minWidth: 0,
        }}
      >
        <div
          style={inputShellStyle({
            flex: '1 1 auto',
            maxWidth: 520,
            border: findShellBorder,
          })}
        >
          <span style={{ color: 'var(--text-tertiary)', flexShrink: 0 }} aria-hidden>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <circle cx="11" cy="11" r="7" />
              <path d="M21 21l-4.35-4.35" />
            </svg>
          </span>
          <input
            ref={inputRef}
            type="text"
            value={queryText}
            onChange={(e) => setQueryText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                if (e.shiftKey) handleFindPrev()
                else handleFindNext()
              }
            }}
            placeholder="查找"
            style={monoInput}
          />
          {queryText ? (
            <button
              type="button"
              title="清空"
              onClick={() => setQueryText('')}
              style={{
                width: 16,
                height: 16,
                border: 'none',
                borderRadius: 8,
                padding: 0,
                cursor: 'pointer',
                background: 'var(--text-hint)',
                color: 'var(--bg-primary)',
                fontSize: 8,
                lineHeight: 1,
                flexShrink: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              ✕
            </button>
          ) : null}
        </div>

        <div style={{ display: 'flex', gap: 2, flexShrink: 0 }}>
          <button
            type="button"
            onClick={handleFindPrev}
            disabled={matchTotal === 0}
            title="上一处 (Shift+Enter)"
            className="search-bar-ctrl"
          >
            ▲
          </button>
          <button
            type="button"
            onClick={handleFindNext}
            disabled={matchTotal === 0}
            title="下一处 (Enter)"
            className="search-bar-ctrl"
          >
            ▼
          </button>
        </div>

        {matchDisplay ? (
          <span
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 11,
              color: 'var(--text-tertiary)',
              whiteSpace: 'nowrap',
              userSelect: 'none',
              flexShrink: 0,
            }}
          >
            {matchDisplay}
          </span>
        ) : null}

        <button
          type="button"
          onClick={handleClose}
          title="关闭 (Esc)"
          className="search-bar-ctrl"
          style={{ marginLeft: 'auto', fontSize: 12 }}
        >
          ✕
        </button>
      </div>

      {/* Replace Row — tKgc5 宽 580 + SPI76 + hCcDq */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          width: '100%',
          flexWrap: 'wrap',
          minWidth: 0,
        }}
      >
        <div
          style={inputShellStyle({
            flex: '1 1 200px',
            maxWidth: 580,
          })}
        >
          <input
            type="text"
            value={replaceText}
            onChange={(e) => setReplaceText(e.target.value)}
            placeholder="替换为..."
            style={monoInput}
          />
        </div>
        <button
          type="button"
          onClick={handleReplaceOne}
          disabled={matchTotal === 0 || !query?.valid}
          title="替换当前匹配"
          style={{
            height: 28,
            padding: '6px 12px',
            borderRadius: 4,
            border: 'none',
            background: matchTotal === 0 ? 'var(--border-subtle)' : 'var(--accent)',
            color: matchTotal === 0 ? 'var(--text-hint)' : '#FFFFFF',
            fontSize: 11,
            fontFamily: 'var(--font-ui)',
            cursor: matchTotal === 0 ? 'default' : 'pointer',
            opacity: matchTotal === 0 ? 0.55 : 1,
            flexShrink: 0,
            transition: 'opacity 150ms ease-out, background-color 150ms ease-out',
          }}
        >
          替换
        </button>
        <button
          type="button"
          onClick={handleReplaceAll}
          disabled={matchTotal === 0 || !query?.valid}
          title="替换全部匹配"
          style={{
            height: 28,
            padding: '6px 12px',
            borderRadius: 4,
            border: '1px solid var(--border-subtle)',
            background: 'var(--bg-card)',
            color: 'var(--text-secondary)',
            fontSize: 11,
            fontFamily: 'var(--font-ui)',
            cursor: matchTotal === 0 ? 'default' : 'pointer',
            opacity: matchTotal === 0 ? 0.55 : 1,
            flexShrink: 0,
            transition: 'background-color 150ms ease-out, color 150ms ease-out, border-color 150ms ease-out',
          }}
          onMouseEnter={(e) => {
            if (matchTotal > 0) {
              e.currentTarget.style.background = 'var(--hover)'
              e.currentTarget.style.color = 'var(--text-primary)'
              e.currentTarget.style.borderColor = 'var(--border-visible)'
            }
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'var(--bg-card)'
            e.currentTarget.style.color = 'var(--text-secondary)'
            e.currentTarget.style.borderColor = 'var(--border-subtle)'
          }}
        >
          全部替换
        </button>
      </div>

      {/* Options Row — LwDAM */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 16,
          flexWrap: 'wrap',
        }}
      >
        {optCheckbox(caseSensitive, () => setCaseSensitive((v) => !v), 'Aa', '区分大小写')}
        {optCheckbox(wholeWord, () => setWholeWord((v) => !v), '全词', '全字匹配')}
        {optCheckbox(regexEnabled, () => setRegexEnabled((v) => !v), <span style={{ fontFamily: 'var(--font-mono)' }}>.*</span>, '正则表达式')}
        <span style={{ fontSize: 11, color: 'var(--text-tertiary)', fontFamily: 'var(--font-ui)' }}>
          范围: <span style={{ color: 'var(--text-secondary)' }}>当前文件</span>
        </span>
      </div>
    </div>
  )
}
