import { useState, useRef, useCallback, useEffect, useMemo } from 'react'
import { useChatStore } from '../../stores/chatStore'
import type { SkillMeta } from '../../../../shared/types'

export interface MentionFileEntry {
  path: string
  name: string
}

interface ChatInputProps {
  onSend: (text: string, opts?: { attachmentPaths?: string[]; skillInvocations?: string[] }) => void
  onCancel: () => void
  isRunning: boolean
  disabled?: boolean
  /** 工作区扫描 + 已打开文件，供 @ 选择 */
  mentionFiles: MentionFileEntry[]
  /** 当前预览文件名（与引用脚注一致） */
  quoteSourceLabel?: string
  /** 已安装 Skill，供 / 补全（Claude Code 风格） */
  slashSkills: SkillMeta[]
}

export function ChatInput({
  onSend,
  onCancel,
  isRunning,
  disabled,
  mentionFiles,
  quoteSourceLabel,
  slashSkills,
}: ChatInputProps) {
  const [text, setText] = useState('')
  const [attachments, setAttachments] = useState<string[]>([])
  const [skillInvocations, setSkillInvocations] = useState<string[]>([])
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  /** 与 state 同步：避免 keydown 早于 React 提交时的闭包滞后，确保上下键可选中补全项 */
  const atOpenRef = useRef(false)
  const slashOpenRef = useRef(false)
  /** 仅当 @ 或 / 后的筛选串变化时重置高亮；避免 keyup 再次 sync 把键盘选中的项打回第一项 */
  const atMenuQuerySnapshotRef = useRef<string | null>(null)
  const slashMenuQuerySnapshotRef = useRef<string | null>(null)
  const quotes = useChatStore((s) => s.quotes)
  const removeQuote = useChatStore((s) => s.removeQuote)
  const inputHistory = useChatStore((s) => s.inputHistory)
  const pushInputHistory = useChatStore((s) => s.pushInputHistory)
  const historyIndexRef = useRef(-1)
  const draftBeforeHistoryRef = useRef('')
  const suppressMenusUntilInputRef = useRef(false)

  /** @ 补全：从光标前最后一个 `@` 到光标为 query */
  const [atOpen, setAtOpen] = useState(false)
  const [atStart, setAtStart] = useState(0)
  const [atQuery, setAtQuery] = useState('')
  const [atHighlight, setAtHighlight] = useState(0)

  /** / 补全：显式调用 Skill */
  const [slashOpen, setSlashOpen] = useState(false)
  const [slashStart, setSlashStart] = useState(0)
  const [slashQuery, setSlashQuery] = useState('')
  const [slashHighlight, setSlashHighlight] = useState(0)
  const slashItemRefs = useRef<Array<HTMLButtonElement | null>>([])

  useEffect(() => {
    if (!isRunning && text === '') {
      textareaRef.current?.focus()
    }
  }, [isRunning, text])

  const syncAtMenu = useCallback((value: string, caret: number) => {
    const before = value.slice(0, caret)
    const atIdx = before.lastIndexOf('@')
    if (atIdx < 0) {
      atOpenRef.current = false
      atMenuQuerySnapshotRef.current = null
      setAtOpen(false)
      return
    }
    const afterAt = before.slice(atIdx + 1)
    if (afterAt.includes('\n') || afterAt.includes(' ')) {
      atOpenRef.current = false
      atMenuQuerySnapshotRef.current = null
      setAtOpen(false)
      return
    }
    setAtStart(atIdx)
    setAtQuery(afterAt)
    atOpenRef.current = true
    setAtOpen(true)
    if (atMenuQuerySnapshotRef.current !== afterAt) {
      atMenuQuerySnapshotRef.current = afterAt
      setAtHighlight(0)
    }
  }, [])

  const syncSlashMenu = useCallback((value: string, caret: number) => {
    const before = value.slice(0, caret)
    const slashIdx = before.lastIndexOf('/')
    if (slashIdx < 0) {
      slashOpenRef.current = false
      slashMenuQuerySnapshotRef.current = null
      setSlashOpen(false)
      return
    }
    const afterSlash = before.slice(slashIdx + 1)
    if (afterSlash.includes('\n') || afterSlash.includes(' ')) {
      slashOpenRef.current = false
      slashMenuQuerySnapshotRef.current = null
      setSlashOpen(false)
      return
    }
    const charBeforeSlash = slashIdx > 0 ? before[slashIdx - 1] : ''
    const slashAtCommandStart = slashIdx === 0 || /\s/.test(charBeforeSlash ?? '')
    if (!slashAtCommandStart) {
      slashOpenRef.current = false
      slashMenuQuerySnapshotRef.current = null
      setSlashOpen(false)
      return
    }
    setSlashStart(slashIdx)
    setSlashQuery(afterSlash)
    slashOpenRef.current = true
    setSlashOpen(true)
    if (slashMenuQuerySnapshotRef.current !== afterSlash) {
      slashMenuQuerySnapshotRef.current = afterSlash
      setSlashHighlight(0)
    }
  }, [])

  const syncMenus = useCallback(
    (value: string, caret: number) => {
      const before = value.slice(0, caret)
      const atIdx = before.lastIndexOf('@')
      const slashIdx = before.lastIndexOf('/')
      if (slashIdx > atIdx) {
        syncSlashMenu(value, caret)
        atOpenRef.current = false
        atMenuQuerySnapshotRef.current = null
        setAtOpen(false)
      } else if (atIdx >= 0) {
        syncAtMenu(value, caret)
        slashOpenRef.current = false
        slashMenuQuerySnapshotRef.current = null
        setSlashOpen(false)
      } else {
        atOpenRef.current = false
        slashOpenRef.current = false
        atMenuQuerySnapshotRef.current = null
        slashMenuQuerySnapshotRef.current = null
        setAtOpen(false)
        setSlashOpen(false)
      }
    },
    [syncAtMenu, syncSlashMenu],
  )

  const filteredMentions = useMemo(() => {
    const q = atQuery.toLowerCase()
    const list = mentionFiles.filter((f) => {
      if (!q) return true
      return f.name.toLowerCase().includes(q) || f.path.toLowerCase().includes(q)
    })
    return list
  }, [mentionFiles, atQuery])

  const filteredSlashSkills = useMemo(() => {
    const q = slashQuery.toLowerCase()
    return slashSkills.filter((s) => {
      if (!q) return true
      return (
        s.name.toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q)
      )
    })
  }, [slashSkills, slashQuery])

  useEffect(() => {
    if (!slashOpen || filteredSlashSkills.length === 0) return
    if (slashHighlight >= filteredSlashSkills.length) {
      setSlashHighlight(Math.max(0, filteredSlashSkills.length - 1))
    }
  }, [slashOpen, filteredSlashSkills.length, slashHighlight])

  useEffect(() => {
    if (!slashOpen || filteredSlashSkills.length === 0) return
    const el = slashItemRefs.current[slashHighlight]
    el?.scrollIntoView({ block: 'nearest' })
  }, [slashOpen, slashHighlight, filteredSlashSkills.length])

  useEffect(() => {
    if (!atOpen || filteredMentions.length === 0) return
    if (atHighlight >= filteredMentions.length) {
      setAtHighlight(Math.max(0, filteredMentions.length - 1))
    }
  }, [atOpen, filteredMentions.length, atHighlight])

  const handleSend = useCallback(() => {
    const trimmed = text.trim()
    if ((!trimmed && skillInvocations.length === 0) || isRunning || disabled) return
    pushInputHistory(trimmed)
    atOpenRef.current = false
    slashOpenRef.current = false
    atMenuQuerySnapshotRef.current = null
    slashMenuQuerySnapshotRef.current = null
    suppressMenusUntilInputRef.current = false
    historyIndexRef.current = -1
    draftBeforeHistoryRef.current = ''
    setAtOpen(false)
    setSlashOpen(false)
    void onSend(trimmed, {
      attachmentPaths: attachments.length ? attachments : undefined,
      skillInvocations: skillInvocations.length ? skillInvocations : undefined,
    })
    setText('')
    setAttachments([])
    setSkillInvocations([])
  }, [text, isRunning, disabled, onSend, attachments, skillInvocations, pushInputHistory])

  const pickMention = useCallback(
    (path: string) => {
      const el = textareaRef.current
      const caret = el?.selectionStart ?? text.length
      const head = text.slice(0, atStart)
      const tail = text.slice(caret)
      const next = `${head}${tail}`.replace(/\s+$/, '')
      setText(next.length ? `${next} ` : '')
      setAttachments((prev) => (prev.includes(path) ? prev : [...prev, path]))
      atOpenRef.current = false
      atMenuQuerySnapshotRef.current = null
      setAtOpen(false)
      requestAnimationFrame(() => {
        el?.focus()
        const pos = head.length + (tail.startsWith(' ') ? 0 : 1)
        el?.setSelectionRange(pos, pos)
      })
    },
    [text, atStart],
  )

  const pickSlashSkill = useCallback(
    (name: string) => {
      const el = textareaRef.current
      const caret = el?.selectionStart ?? text.length
      const head = text.slice(0, slashStart)
      const tail = text.slice(caret)
      const next = `${head}${tail}`.replace(/\s+$/, '')
      setText(next.length ? `${next} ` : '')
      setSkillInvocations((prev) => (prev.includes(name) ? prev : [...prev, name]))
      slashOpenRef.current = false
      slashMenuQuerySnapshotRef.current = null
      setSlashOpen(false)
      requestAnimationFrame(() => {
        el?.focus()
        const pos = head.length + (tail.startsWith(' ') ? 0 : 1)
        el?.setSelectionRange(pos, pos)
      })
    },
    [text, slashStart],
  )

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.nativeEvent.isComposing || e.key === 'Process') return

      if (slashOpenRef.current && filteredSlashSkills.length > 0) {
        if (e.key === 'ArrowDown') {
          e.preventDefault()
          setSlashHighlight((i) => (i + 1) % filteredSlashSkills.length)
          return
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault()
          setSlashHighlight((i) => (i - 1 + filteredSlashSkills.length) % filteredSlashSkills.length)
          return
        }
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault()
          pickSlashSkill(filteredSlashSkills[slashHighlight]!.name)
          return
        }
        if (e.key === 'Escape') {
          e.preventDefault()
          slashOpenRef.current = false
          slashMenuQuerySnapshotRef.current = null
          setSlashOpen(false)
          return
        }
      }

      if (atOpenRef.current && filteredMentions.length > 0) {
        if (e.key === 'ArrowDown') {
          e.preventDefault()
          setAtHighlight((i) => (i + 1) % filteredMentions.length)
          return
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault()
          setAtHighlight((i) => (i - 1 + filteredMentions.length) % filteredMentions.length)
          return
        }
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault()
          pickMention(filteredMentions[atHighlight]!.path)
          return
        }
        if (e.key === 'Escape') {
          e.preventDefault()
          atOpenRef.current = false
          atMenuQuerySnapshotRef.current = null
          setAtOpen(false)
          return
        }
      }

      if (e.key === 'Enter' && !e.shiftKey && !(e.ctrlKey || e.metaKey)) {
        e.preventDefault()
        handleSend()
        return
      }

      const hasModifier = e.ctrlKey || e.metaKey || e.altKey || e.shiftKey
      const textarea = e.currentTarget
      const selectionStart = textarea.selectionStart ?? text.length
      const selectionEnd = textarea.selectionEnd ?? text.length
      const caretAtEnd = selectionStart === text.length && selectionEnd === text.length

      if (!hasModifier && e.key === 'ArrowUp' && caretAtEnd && inputHistory.length > 0) {
        e.preventDefault()
        if (historyIndexRef.current === -1) {
          draftBeforeHistoryRef.current = text
          historyIndexRef.current = inputHistory.length - 1
        } else if (historyIndexRef.current > 0) {
          historyIndexRef.current -= 1
        }
        const nextText = inputHistory[historyIndexRef.current] ?? ''
        atOpenRef.current = false
        slashOpenRef.current = false
        atMenuQuerySnapshotRef.current = null
        slashMenuQuerySnapshotRef.current = null
        setAtOpen(false)
        setSlashOpen(false)
        suppressMenusUntilInputRef.current = true
        setText(nextText)
        requestAnimationFrame(() => {
          textareaRef.current?.setSelectionRange(nextText.length, nextText.length)
        })
        return
      }

      if (!hasModifier && e.key === 'ArrowDown' && caretAtEnd && historyIndexRef.current !== -1) {
        e.preventDefault()
        suppressMenusUntilInputRef.current = true
        if (historyIndexRef.current < inputHistory.length - 1) {
          historyIndexRef.current += 1
          const nextText = inputHistory[historyIndexRef.current] ?? ''
          atOpenRef.current = false
          slashOpenRef.current = false
          atMenuQuerySnapshotRef.current = null
          slashMenuQuerySnapshotRef.current = null
          setAtOpen(false)
          setSlashOpen(false)
          setText(nextText)
          requestAnimationFrame(() => {
            textareaRef.current?.setSelectionRange(nextText.length, nextText.length)
          })
        } else {
          historyIndexRef.current = -1
          const draft = draftBeforeHistoryRef.current
          draftBeforeHistoryRef.current = ''
          atOpenRef.current = false
          slashOpenRef.current = false
          atMenuQuerySnapshotRef.current = null
          slashMenuQuerySnapshotRef.current = null
          setAtOpen(false)
          setSlashOpen(false)
          setText(draft)
          requestAnimationFrame(() => {
            textareaRef.current?.setSelectionRange(draft.length, draft.length)
          })
        }
        return
      }

      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault()
        handleSend()
        return
      }
      if (e.key === 'Escape' && isRunning) {
        e.preventDefault()
        onCancel()
      }
    },
    [
      filteredSlashSkills,
      slashHighlight,
      pickSlashSkill,
      filteredMentions,
      atHighlight,
      pickMention,
      handleSend,
      isRunning,
      onCancel,
      inputHistory,
      text,
    ],
  )

  return (
    <div className="chat-input-container" style={{ position: 'relative' }}>
      {quotes.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {quotes.map((q) => (
            <span
              key={q.id}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-mono bg-[var(--bg-card)] border border-[var(--border-visible)] text-[var(--accent)] max-w-full"
            >
              <span className="truncate" title={q.sourceLabel ?? quoteSourceLabel ?? '编辑器'}>
                @{q.sourceLabel ?? quoteSourceLabel ?? '编辑器'}
                {q.range ? `#${q.range.startLine}-${q.range.endLine}` : ''}
              </span>
              <button
                type="button"
                className="text-[var(--text-hint)] hover:text-[var(--error)]"
                onClick={() => removeQuote(q.id)}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      {skillInvocations.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {skillInvocations.map((name) => (
            <span
              key={name}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-mono bg-[var(--bg-card)] border border-[var(--border-visible)] text-[var(--accent)] max-w-full"
            >
              <span className="truncate" title={name}>
                /{name}
              </span>
              <button
                type="button"
                className="text-[var(--text-hint)] hover:text-[var(--error)]"
                onClick={() => setSkillInvocations((a) => a.filter((x) => x !== name))}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      {attachments.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {attachments.map((p) => (
            <span
              key={p}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-mono bg-[var(--bg-card)] border border-[var(--border-subtle)] text-[var(--text-secondary)] max-w-full"
            >
              <span className="truncate" title={p}>
                @{p.split(/[/\\]/).pop()}
              </span>
              <button
                type="button"
                className="text-[var(--text-hint)] hover:text-[var(--error)]"
                onClick={() => setAttachments((a) => a.filter((x) => x !== p))}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      {slashOpen && filteredSlashSkills.length > 0 && (
        <div
          className="absolute left-0 right-0 bottom-full mb-1 z-50 rounded-[var(--radius-sm)] border border-[var(--border-visible)] bg-[var(--bg-card)] shadow-lg max-h-[min(22rem,70vh)] overflow-y-auto flux-scroll"
          role="listbox"
          aria-label="Skill 列表"
        >
          {filteredSlashSkills.map((s, i) => (
            <button
              key={s.name}
              ref={(el) => {
                slashItemRefs.current[i] = el
              }}
              type="button"
              role="option"
              aria-selected={i === slashHighlight}
              className={`w-full text-left px-2 py-1.5 text-app-xs hover:bg-[var(--hover)] ${
                i === slashHighlight ? 'bg-[var(--selection)]' : ''
              }`}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pickSlashSkill(s.name)}
            >
              <span className="font-mono text-[var(--accent)]">/{s.name}</span>
              {s.description ? (
                <span className="block text-[10px] text-[var(--text-hint)] truncate mt-0.5">
                  {s.description}
                </span>
              ) : null}
            </button>
          ))}
        </div>
      )}

      {atOpen && filteredMentions.length > 0 && (
        <div
          className="absolute left-0 right-0 bottom-full mb-1 z-50 rounded-[var(--radius-sm)] border border-[var(--border-visible)] bg-[var(--bg-card)] shadow-lg max-h-[min(22rem,70vh)] overflow-y-auto flux-scroll"
          role="listbox"
        >
          {filteredMentions.map((f, i) => (
            <button
              key={f.path}
              type="button"
              role="option"
              aria-selected={i === atHighlight}
              className={`w-full text-left px-2 py-1.5 text-app-xs font-mono truncate hover:bg-[var(--hover)] ${
                i === atHighlight ? 'bg-[var(--selection)]' : ''
              }`}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pickMention(f.path)}
            >
              {f.name}
            </button>
          ))}
        </div>
      )}

      <div className="chat-input-card">
          <textarea
            ref={textareaRef}
            className="chat-input-textarea"
            value={text}
            onChange={(e) => {
              const v = e.target.value
              historyIndexRef.current = -1
              draftBeforeHistoryRef.current = ''
              suppressMenusUntilInputRef.current = false
              setText(v)
              syncMenus(v, e.target.selectionStart)
            }}
            onSelect={(e) => {
              if (suppressMenusUntilInputRef.current) return
              syncMenus(e.currentTarget.value, e.currentTarget.selectionStart)
            }}
            onKeyUp={(e) => {
              if (suppressMenusUntilInputRef.current) return
              syncMenus(
                e.currentTarget.value,
                e.currentTarget.selectionStart ?? e.currentTarget.value.length,
              )
            }}
            onKeyDown={handleKeyDown}
            placeholder="输入你的想法..."
            disabled={isRunning || disabled}
            rows={1}
            autoFocus
          />
          <div className="chat-input-actions">
            {isRunning ? (
              <button
                onClick={onCancel}
                className="chat-input-stop-btn"
                title="停止生成 (Esc)"
              >
                <svg width="12" height="12" viewBox="0 0 12 12" fill="var(--error)">
                  <rect x="2" y="2" width="8" height="8" rx="1" />
                </svg>
              </button>
            ) : (
              <button
                onClick={handleSend}
                disabled={(!text.trim() && skillInvocations.length === 0) || disabled}
                className="chat-input-send-btn"
                title="发送 (Enter)"
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="7" y1="12" x2="7" y2="2" />
                  <polyline points="3,6 7,2 11,6" />
                </svg>
              </button>
            )}
          </div>
        </div>
    </div>
  )
}
