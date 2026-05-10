import { useCallback, useRef, useEffect, useState } from 'react'
import type { EditorView } from '@codemirror/view'
import {
  SearchQuery,
  setSearchQuery,
  getSearchQuery,
  findNext,
  findPrevious,
  replaceNext,
  replaceAll,
} from '@codemirror/search'
import { useSettingsStore } from '../../stores/settingsStore'

interface SearchPanelProps {
  view: EditorView | null
  onClose: () => void
}

export function SearchPanel({ view, onClose }: SearchPanelProps) {
  const [searchText, setSearchText] = useState('')
  const [replaceText, setReplaceText] = useState('')
  const [caseSensitive, setCaseSensitive] = useState(false)
  const [wholeWord, setWholeWord] = useState(false)
  const [regexp, setRegexp] = useState(false)
  const [matchInfo, setMatchInfo] = useState('')
  const [showReplace, setShowReplace] = useState(false)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const theme = useSettingsStore((s) => s.theme)

  // 面板打开时自动获焦，并从当前编辑器查询状态同步初始值
  useEffect(() => {
    if (!view) return
    const q = getSearchQuery(view.state)
    if (q.search) {
      setSearchText(q.search)
      setCaseSensitive(q.caseSensitive)
      setWholeWord(q.wholeWord)
      setRegexp(q.regexp)
    }
    searchInputRef.current?.focus()
    searchInputRef.current?.select()
  }, [view])

  // 将当前 UI 状态同步到 CM6 搜索状态（触发高亮）
  const dispatchQuery = useCallback(
    (overrides?: Partial<{ search: string; replace: string; caseSensitive: boolean; wholeWord: boolean; regexp: boolean }>) => {
      if (!view) return
      const q = new SearchQuery({
        search: overrides?.search ?? searchText,
        replace: overrides?.replace ?? replaceText,
        caseSensitive: overrides?.caseSensitive ?? caseSensitive,
        wholeWord: overrides?.wholeWord ?? wholeWord,
        regexp: overrides?.regexp ?? regexp,
      })
      view.dispatch({ effects: setSearchQuery.of(q) })
    },
    [view, searchText, replaceText, caseSensitive, wholeWord, regexp],
  )

  // 计算匹配计数
  const updateMatchInfo = useCallback(
    (query: SearchQuery) => {
      if (!view || !query.search || !query.valid) {
        setMatchInfo('')
        return
      }
      try {
        const cursor = query.getCursor(view.state.doc)
        let total = 0
        let current = 0
        const head = view.state.selection.main.head
        while (!cursor.done) {
          cursor.next()
          if (!cursor.done) {
            total++
            if (cursor.value.from <= head) current = total
          }
        }
        if (total === 0) {
          setMatchInfo('无匹配')
        } else {
          setMatchInfo(`${current}/${total}`)
        }
      } catch {
        setMatchInfo('')
      }
    },
    [view],
  )

  // 搜索文本变化时同步
  const handleSearchChange = useCallback(
    (value: string) => {
      setSearchText(value)
      const q = new SearchQuery({ search: value, replace: replaceText, caseSensitive, wholeWord, regexp })
      if (view) {
        view.dispatch({ effects: setSearchQuery.of(q) })
        updateMatchInfo(q)
      }
    },
    [view, replaceText, caseSensitive, wholeWord, regexp, updateMatchInfo],
  )

  // 选项变化时同步
  const handleOptionChange = useCallback(
    (opts: Partial<{ caseSensitive: boolean; wholeWord: boolean; regexp: boolean }>) => {
      const next = { caseSensitive, wholeWord, regexp, ...opts }
      if ('caseSensitive' in opts) setCaseSensitive(opts.caseSensitive!)
      if ('wholeWord' in opts) setWholeWord(opts.wholeWord!)
      if ('regexp' in opts) setRegexp(opts.regexp!)
      const q = new SearchQuery({ search: searchText, replace: replaceText, ...next })
      if (view) {
        view.dispatch({ effects: setSearchQuery.of(q) })
        updateMatchInfo(q)
      }
    },
    [view, searchText, replaceText, caseSensitive, wholeWord, regexp, updateMatchInfo],
  )

  // 跳到下一个
  const handleNext = useCallback(() => {
    if (!view || !searchText) return
    dispatchQuery()
    findNext(view)
    const q = getSearchQuery(view.state)
    updateMatchInfo(q)
  }, [view, searchText, dispatchQuery, updateMatchInfo])

  // 跳到上一个
  const handlePrev = useCallback(() => {
    if (!view || !searchText) return
    dispatchQuery()
    findPrevious(view)
    const q = getSearchQuery(view.state)
    updateMatchInfo(q)
  }, [view, searchText, dispatchQuery, updateMatchInfo])

  // 替换当前
  const handleReplaceNext = useCallback(() => {
    if (!view || !searchText) return
    dispatchQuery()
    replaceNext(view)
    const q = getSearchQuery(view.state)
    updateMatchInfo(q)
  }, [view, searchText, dispatchQuery, updateMatchInfo])

  // 全部替换
  const handleReplaceAll = useCallback(() => {
    if (!view || !searchText) return
    dispatchQuery()
    replaceAll(view)
    setMatchInfo('已全部替换')
  }, [view, searchText, dispatchQuery])

  // 关闭面板
  const handleClose = useCallback(() => {
    // 清除搜索高亮
    if (view) {
      view.dispatch({ effects: setSearchQuery.of(new SearchQuery({ search: '' })) })
    }
    onClose()
  }, [view, onClose])

  // 搜索框按键
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

  // 替换框按键
  const handleReplaceKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        e.ctrlKey || e.metaKey ? handleReplaceAll() : handleReplaceNext()
      } else if (e.key === 'Escape') {
        e.preventDefault()
        handleClose()
      }
    },
    [handleReplaceNext, handleReplaceAll, handleClose],
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
    fontFamily: 'var(--font-mono)',
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
        flexShrink: 0,
        zIndex: 10,
        background: isDark ? 'var(--bg-panel)' : 'var(--bg-card)',
        borderBottom: '2px solid var(--accent)',
        padding: '10px 14px',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        boxShadow: '0 2px 10px rgba(0,0,0,0.18)',
      }}
      // 阻止 mousedown 冒泡，防止点击面板时编辑器失焦触发 CM 原生行为
      onMouseDown={(e) => e.stopPropagation()}
    >
      {/* 搜索行 */}
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
          title="切换替换行"
          onClick={() => setShowReplace((v) => !v)}
          style={{
            ...btnBase,
            background: showReplace ? 'var(--accent)' : 'transparent',
            color: showReplace ? '#fff' : 'var(--text-secondary)',
            borderColor: showReplace ? 'var(--accent)' : 'var(--border-subtle)',
          }}
          onMouseEnter={(e) => { if (!showReplace) onHover(e) }}
          onMouseLeave={(e) => { if (!showReplace) offHover(e) }}
        >替换</button>
        <button
          title="关闭 (Esc)"
          onClick={handleClose}
          style={{ ...btnBase, padding: '5px 8px', color: 'var(--text-hint)', borderColor: 'transparent' }}
          onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-primary)'; e.currentTarget.style.borderColor = 'var(--border-subtle)' }}
          onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-hint)'; e.currentTarget.style.borderColor = 'transparent' }}
        >✕</button>
      </div>

      {/* 选项行 */}
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

      {/* 替换行 */}
      {showReplace && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', borderTop: '1px solid var(--border-subtle)', paddingTop: 8 }}>
          <input
            type="text"
            placeholder="替换为..."
            value={replaceText}
            onChange={(e) => setReplaceText(e.target.value)}
            onKeyDown={handleReplaceKeyDown}
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
          <button style={btnBase} title="替换当前 (Enter)" onClick={handleReplaceNext} onMouseEnter={onHover} onMouseLeave={offHover}>替换</button>
          <button style={btnBase} title="全部替换 (Ctrl+Enter)" onClick={handleReplaceAll} onMouseEnter={onHover} onMouseLeave={offHover}>全部替换</button>
        </div>
      )}
    </div>
  )
}
