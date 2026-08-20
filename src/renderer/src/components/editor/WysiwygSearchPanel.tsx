import { useCallback, useEffect, useRef, useState } from 'react'
import { SearchQuery, findNext, findPrev, setSearchState, getSearchState } from 'prosemirror-search'
import { search as searchPlugin } from 'prosemirror-search'
import { $prose } from '@milkdown/utils'
import type { EditorView } from '@milkdown/prose/view'
import { useSettingsStore } from '../../stores/settingsStore'

/** 注册 prosemirror-search 插件到 Milkdown（搜索高亮与状态由该插件维护） */
export const wysiwygSearchPlugin = $prose(() => searchPlugin())

interface WysiwygSearchPanelProps {
  view: EditorView | null
  onClose: () => void
}

function scrollActiveMatchIntoView(view: EditorView): void {
  window.requestAnimationFrame(() => {
    const scrollContainer = view.dom.closest<HTMLElement>('.flux-scroll')
    if (!scrollContainer) return
    const coords = view.coordsAtPos(view.state.selection.from)
    const containerRect = scrollContainer.getBoundingClientRect()
    const targetTop = coords.top - containerRect.top
    if (targetTop < 0 || targetTop > containerRect.height - Math.max(1, coords.bottom - coords.top)) {
      scrollContainer.scrollTop += targetTop - containerRect.height / 2
    }
  })
}

/**
 * WYSIWYG（Milkdown）编辑面搜索面板：与源码区域 SearchPanel 交互与样式保持一致，
 * 底层由 prosemirror-search 插件驱动（注册于 wysiwygSearchPlugin）。
 */
export function WysiwygSearchPanel({ view, onClose }: WysiwygSearchPanelProps) {
  const [searchText, setSearchText] = useState('')
  const [caseSensitive, setCaseSensitive] = useState(false)
  const [wholeWord, setWholeWord] = useState(false)
  const [regexp, setRegexp] = useState(false)
  const [matchInfo, setMatchInfo] = useState('')
  const searchInputRef = useRef<HTMLInputElement>(null)
  const theme = useSettingsStore((s) => s.theme)

  // 面板打开时自动获焦，并从当前搜索状态同步初始值
  useEffect(() => {
    if (!view) return
    const state = getSearchState(view.state)
    if (state?.query.search) {
      setSearchText(state.query.search)
      setCaseSensitive(state.query.caseSensitive)
      setWholeWord(state.query.wholeWord)
      setRegexp(state.query.regexp)
    }
    searchInputRef.current?.focus()
    searchInputRef.current?.select()
  }, [view])

  // 构造 SearchQuery 并 dispatch（触发高亮）
  const dispatchQuery = useCallback(
    (overrides?: Partial<{ search: string; caseSensitive: boolean; wholeWord: boolean; regexp: boolean }>) => {
      if (!view) return
      const q = new SearchQuery({
        search: overrides?.search ?? searchText,
        caseSensitive: overrides?.caseSensitive ?? caseSensitive,
        wholeWord: overrides?.wholeWord ?? wholeWord,
        regexp: overrides?.regexp ?? regexp,
      })
      view.dispatch(setSearchState(view.state.tr, q))
      updateMatchInfo(q)
    },
    [view, searchText, caseSensitive, wholeWord, regexp],
  )

  // 计算匹配计数
  const updateMatchInfo = useCallback(
    (query: SearchQuery) => {
      if (!view || !query.search || !query.valid) {
        setMatchInfo('')
        return
      }
      try {
        let total = 0
        let current = 0
        const head = view.state.selection.from
        let pos = 0
        const docSize = view.state.doc.content.size
        while (pos <= docSize) {
          const result = query.findNext(view.state, pos)
          if (!result) break
          total++
          if (result.from <= head) current = total
          pos = result.to > pos ? result.to : pos + 1
        }
        setMatchInfo(total === 0 ? '无匹配' : `${current}/${total}`)
      } catch {
        setMatchInfo('')
      }
    },
    [view],
  )

  const handleSearchChange = useCallback(
    (value: string) => {
      setSearchText(value)
      dispatchQuery({ search: value })
    },
    [dispatchQuery],
  )

  const handleOptionChange = useCallback(
    (opts: Partial<{ caseSensitive: boolean; wholeWord: boolean; regexp: boolean }>) => {
      const next = { caseSensitive, wholeWord, regexp, ...opts }
      if ('caseSensitive' in opts) setCaseSensitive(opts.caseSensitive!)
      if ('wholeWord' in opts) setWholeWord(opts.wholeWord!)
      if ('regexp' in opts) setRegexp(opts.regexp!)
      dispatchQuery(next)
    },
    [dispatchQuery, caseSensitive, wholeWord, regexp],
  )

  const handleNext = useCallback(() => {
    if (!view || !searchText) return
    dispatchQuery()
    if (findNext(view.state, view.dispatch)) scrollActiveMatchIntoView(view)
    const state = getSearchState(view.state)
    if (state) updateMatchInfo(state.query)
  }, [view, searchText, dispatchQuery, updateMatchInfo])

  const handlePrev = useCallback(() => {
    if (!view || !searchText) return
    dispatchQuery()
    if (findPrev(view.state, view.dispatch)) scrollActiveMatchIntoView(view)
    const state = getSearchState(view.state)
    if (state) updateMatchInfo(state.query)
  }, [view, searchText, dispatchQuery, updateMatchInfo])

  const handleClose = useCallback(() => {
    // 清除搜索高亮
    if (view) {
      view.dispatch(setSearchState(view.state.tr, new SearchQuery({ search: '' })))
    }
    onClose()
  }, [view, onClose])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        e.shiftKey ? handlePrev() : handleNext()
      } else if (e.key === 'Escape') {
        e.preventDefault()
        handleClose()
      }
    },
    [handleNext, handlePrev, handleClose],
  )

  const isDark = theme !== 'light'

  const btnBase: React.CSSProperties = {
    background: 'transparent',
    color: 'var(--text-secondary)',
    border: '1px solid var(--border-subtle)',
    borderRadius: 5,
    padding: '5px 10px',
    fontSize: 'var(--font-size-app-xs)',
    fontFamily: 'var(--font-ui)',
    cursor: 'pointer',
    whiteSpace: 'nowrap',
    lineHeight: 1.4,
    transition: 'background 120ms, color 120ms, border-color 120ms',
  }

  const inputBase: React.CSSProperties = {
    background: 'var(--bg-viewer)',
    color: 'var(--text-primary)',
    border: '1px solid var(--border-visible)',
    borderRadius: 6,
    padding: '6px 10px',
    fontFamily: 'var(--font-ui)',
    fontSize: 'var(--font-size-app-xs)',
    outline: 'none',
    caretColor: 'var(--accent)',
    minWidth: 180,
    flex: 1,
    transition: 'border-color 120ms, box-shadow 120ms',
  }

  const onHover = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.currentTarget.style.background = 'var(--accent)'
    e.currentTarget.style.color = '#ffffff'
    e.currentTarget.style.borderColor = 'var(--accent)'
  }
  const offHover = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.currentTarget.style.background = 'transparent'
    e.currentTarget.style.color = 'var(--text-secondary)'
    e.currentTarget.style.borderColor = 'var(--border-subtle)'
  }

  return (
    <div
      style={{
        position: 'sticky',
        top: 0,
        flexShrink: 0,
        zIndex: 10,
        background: isDark ? 'var(--bg-panel)' : 'var(--bg-card)',
        borderBottom: '2px solid var(--accent)',
        padding: '10px 14px',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        boxShadow: '0 2px 10px rgba(0,0,0,0.18)',
        fontFamily: 'var(--font-ui)',
      }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        <input
          ref={searchInputRef}
          type="text"
          placeholder="搜索..."
          value={searchText}
          onChange={(e) => handleSearchChange(e.target.value)}
          onKeyDown={handleKeyDown}
          style={inputBase}
          onFocus={(e) => {
            e.currentTarget.style.borderColor = 'var(--accent)'
            e.currentTarget.style.boxShadow = '0 0 0 3px rgba(10,132,255,0.1)'
          }}
          onBlur={(e) => {
            e.currentTarget.style.borderColor = 'var(--border-visible)'
            e.currentTarget.style.boxShadow = 'none'
          }}
        />
        {matchInfo && (
          <span style={{ fontSize: 'var(--font-size-app-xs)', color: 'var(--text-hint)', whiteSpace: 'nowrap', minWidth: 48 }}>
            {matchInfo}
          </span>
        )}
        <button style={btnBase} title="上一个 (Shift+Enter)" onClick={handlePrev} onMouseEnter={onHover} onMouseLeave={offHover}>↑</button>
        <button style={btnBase} title="下一个 (Enter)" onClick={handleNext} onMouseEnter={onHover} onMouseLeave={offHover}>↓</button>
        <button
          title="关闭 (Esc)"
          onClick={handleClose}
          style={{ ...btnBase, padding: '5px 8px', color: 'var(--text-hint)', borderColor: 'transparent' }}
          onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-primary)'; e.currentTarget.style.borderColor = 'var(--border-subtle)' }}
          onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-hint)'; e.currentTarget.style.borderColor = 'transparent' }}
        >✕</button>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        {(
          [
            { label: '区分大小写', key: 'caseSensitive', value: caseSensitive },
            { label: '全词匹配', key: 'wholeWord', value: wholeWord },
            { label: '正则表达式', key: 'regexp', value: regexp },
          ] as const
        ).map(({ label, key, value }) => (
          <label key={key} style={{ display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer', userSelect: 'none' }}>
            <input
              type="checkbox"
              checked={value}
              onChange={(e) => handleOptionChange({ [key]: e.target.checked })}
              style={{ cursor: 'pointer', accentColor: 'var(--accent)', width: 13, height: 13 }}
            />
            <span style={{ fontSize: 'var(--font-size-app-xs)', color: 'var(--text-secondary)' }}>{label}</span>
          </label>
        ))}
      </div>
    </div>
  )
}
