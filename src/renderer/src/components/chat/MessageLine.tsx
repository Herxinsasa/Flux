import { useMemo, Fragment, useCallback, useState } from 'react'
import { Copy, Check } from 'lucide-react'
import type { Message } from '../../stores/chatStore'
import { useEditorStore } from '../../stores/editorStore'
import { useFileStore } from '../../stores/fileStore'
import { MdPreview } from '../editor/MdPreview'

interface MessageLineProps {
  message: Message
  isStreaming: boolean
}

/** Regex to detect file:line references like `src/app.ts:42` or `file.md:10` */
const LINE_REF_RE =
  /(\S+[.][a-z]{1,10}):(\d{1,8})(?=\s|[.,;:!?)]|$)/gi

interface TextSegment {
  type: 'text' | 'ref'
  content: string
  filePath?: string
  line?: number
}

function parseContent(content: string): TextSegment[] {
  const segments: TextSegment[] = []
  let lastIndex = 0
  const re = new RegExp(LINE_REF_RE.source, LINE_REF_RE.flags)
  let match: RegExpExecArray | null

  while ((match = re.exec(content)) !== null) {
    if (match.index > lastIndex) {
      segments.push({
        type: 'text',
        content: content.slice(lastIndex, match.index),
      })
    }
    segments.push({
      type: 'ref',
      content: match[0],
      filePath: match[1],
      line: parseInt(match[2], 10),
    })
    lastIndex = re.lastIndex
  }

  if (lastIndex < content.length) {
    segments.push({ type: 'text', content: content.slice(lastIndex) })
  }

  return segments
}

export function MessageLine({ message, isStreaming }: MessageLineProps) {
  const isUser = message.role === 'user'
  const segments = useMemo(() => parseContent(message.content), [message.content])
  const [copied, setCopied] = useState(false)

  const handleLineRefClick = useCallback(
    (filePath: string, line: number) => {
      const currentFile = useFileStore.getState().currentFile
      if (currentFile !== filePath) {
        useFileStore.getState().setCurrentFile(filePath)
      }
      useEditorStore.getState().setCursorLine(line)
    },
    [],
  )

  const handleCopyAi = useCallback(async () => {
    const text = message.content ?? ''
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      try {
        const ta = document.createElement('textarea')
        ta.value = text
        ta.style.position = 'fixed'
        ta.style.left = '-9999px'
        document.body.appendChild(ta)
        ta.select()
        document.execCommand('copy')
        document.body.removeChild(ta)
        setCopied(true)
        window.setTimeout(() => setCopied(false), 2000)
      } catch {
        /* ignore */
      }
    }
  }, [message.content])

  return (
    <div className={`msg-row ${isUser ? 'msg-row--user' : 'msg-row--ai'}`} data-role={message.role}>
      <div className={`msg-bubble ${isUser ? 'msg-bubble--user' : 'msg-bubble--ai'}`}>
        {isUser ? (
          <>
            <div className="msg-line-content msg-line-content--plain">
              {segments.map((seg, i) =>
                seg.type === 'ref' && seg.filePath && seg.line ? (
                  <button
                    key={i}
                    type="button"
                    className="line-ref-link"
                    onClick={() => handleLineRefClick(seg.filePath!, seg.line!)}
                    title={`Jump to ${seg.filePath}:${seg.line}`}
                  >
                    {seg.content}
                  </button>
                ) : (
                  <Fragment key={i}>{seg.content}</Fragment>
                ),
              )}
            </div>
            {message.contextFootnote ? (
              <div className="msg-context-footnote mt-1.5 text-[11px] text-[var(--text-hint)] font-mono break-all leading-snug">
                {message.contextFootnote}
              </div>
            ) : null}
          </>
        ) : (
          <>
            <div className="msg-bubble-ai-toolbar">
              <button
                type="button"
                className="msg-copy-btn"
                onClick={() => void handleCopyAi()}
                title={copied ? '已复制' : '复制全文'}
                aria-label={copied ? '已复制到剪贴板' : '复制 AI 回复全文'}
              >
                {copied ? (
                  <Check size={14} strokeWidth={2} aria-hidden />
                ) : (
                  <Copy size={14} strokeWidth={2} aria-hidden />
                )}
              </button>
            </div>
            <div className="msg-line-content msg-line-content--markdown">
              {(message.content.trim() || isStreaming) && (
                <MdPreview content={message.content} hideEmptyPlaceholder />
              )}
              {isStreaming && <span className="streaming-cursor" aria-hidden />}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
