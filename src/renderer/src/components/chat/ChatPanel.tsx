import { useRef, useEffect, useCallback, useMemo, useState } from 'react'
import { Settings } from 'lucide-react'
import { Virtuoso } from 'react-virtuoso'
import type { VirtuosoHandle } from 'react-virtuoso'

import { useSettingsStore } from '../../stores/settingsStore'
import { useChatStore } from '../../stores/chatStore'
import { useFileStore } from '../../stores/fileStore'
import { useEditorStore } from '../../stores/editorStore'
import type { AgentStatus, Message } from '../../stores/chatStore'

import { MessageLine } from './MessageLine'
import { ToolCallCard } from './ToolCallCard'
import { SuggestionChips } from './SuggestionChips'
import { ChatInput } from './ChatInput'
import { ReportExport } from '../export/ReportExport'
import { useEditorChatBridge } from '../../hooks/useEditorChatBridge'
import type { PreviewChangeData } from '../../hooks/useEditorChatBridge'
import { marginBottomAfterItem, type ChatItem } from './chatListSpacing'
import { QuietSearchToolRow } from './QuietSearchToolRow'
import type { SkillMeta } from '../../../../shared/types'

const WORKING_HINTS = [
  '思考中...',
  '梦游中...',
  '发呆中...',
  '绞尽脑汁中...',
  '开始幻想中...',
  'CPU 在冒烟...',
  '脑细胞加班中...',
  '正在和 Bug 谈判...',
  '灵感加载 99%...',
  '代码精灵请就位...',
  '正在召唤正确答案...',
  '马上就好，先别眨眼...',
]

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** 从正文解析 `/技能名`（与 chips 合并使用） */
function extractSlashSkillNames(text: string): string[] {
  const out: string[] = []
  const re = /(^|[\s\n])\/([\w\u4e00-\u9fff][\w\u4e00-\u9fff\-]*)(?=$|[\s,.:;!?，。：；！？、])/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    const nm = m[2]
    if (!out.includes(nm)) out.push(nm)
  }
  return out
}

function stripSlashSkillTokens(text: string, names: string[]): string {
  if (names.length === 0) return text.trim()
  let s = text
  const sorted = [...names].sort((a, b) => b.length - a.length)
  for (const name of sorted) {
    const esc = escapeRegExp(name)
    s = s.replace(new RegExp(`(^|[\\s])\\/${esc}(?=$|[\\s])`, 'gm'), '$1')
    s = s.replace(new RegExp(`^\\/${esc}(?=$|[\\s])`, 'gm'), '')
  }
  return s.replace(/\n{3,}/g, '\n\n').trim()
}

function hasReportIntent(text: string): boolean {
  const t = text.toLowerCase()
  if (!t.trim()) return false
  if (t.includes('/analysis-report')) return true
  return (
    /(导出|输出|生成|撰写|整理).{0,12}(分析报告|正式报告|markdown\s*报告|结构化报告|报告)/i.test(t) ||
    /(分析结果|结论).{0,10}(做成|整理成|写成).{0,10}(报告|文档)/i.test(t)
  )
}

/** 用于 write_file 允许的目录前缀（与主进程 path.dirname 一致语义） */
function parentDir(filePath: string): string {
  const m = filePath.match(/^(.*)[/\\][^/\\]+$/)
  return m ? m[1]! : filePath
}

interface ChatPanelProps {
  onNavigateToSettings?: () => void
}

/* ------------------------------------------------------------------ */
/*  Agent status labels                                                */
/* ------------------------------------------------------------------ */

const STATUS_LABELS: Record<AgentStatus, string> = {
  idle: '',
  running: 'Agent 运行中',
  streaming: 'Agent 运行中',
  restarting: 'Agent 已恢复',
  error: 'Agent 错误，请重试',
}

/* ------------------------------------------------------------------ */
/*  Stream event types                                                 */
/* ------------------------------------------------------------------ */

interface ParsedToolUse {
  type: 'tool_use'
  id: string
  name: string
  input: unknown
}

interface ParsedToolResult {
  type: 'tool_result'
  id: string
  content: string
  isError?: boolean
}

interface ParsedError {
  type: 'error'
  message: string
}

interface ParsedStatus {
  type: 'status'
  status: string
}

interface ParsedReasoningDelta {
  type: 'reasoning_delta'
  text: string
}

interface ParsedProgress {
  type: 'progress'
  stage: string
  message: string
  elapsedMs?: number
  tool?: string
  meta?: Record<string, unknown>
}

type ParsedStreamEvent =
  | ParsedToolUse
  | ParsedToolResult
  | ParsedError
  | ParsedStatus
  | ParsedReasoningDelta
  | ParsedProgress

interface TextDeltaEvent {
  type: 'text_delta'
  text: string
}

interface DoneEvent {
  type: 'done'
}

type StreamEvent = ParsedStreamEvent | TextDeltaEvent | DoneEvent

function parseStreamEvent(data: string): StreamEvent {
  if (data === '[DONE]') return { type: 'done' }

  if (data.startsWith('{')) {
    try {
      const parsed = JSON.parse(data)
      if (
        parsed.type === 'tool_use' ||
        parsed.type === 'tool_result' ||
        parsed.type === 'error' ||
        parsed.type === 'status' ||
        parsed.type === 'reasoning_delta' ||
        parsed.type === 'progress'
      ) {
        return parsed as ParsedStreamEvent
      }
    } catch {
      /* ignore parse errors — treat as text */
    }
  }

  return { type: 'text_delta', text: data }
}

/* ------------------------------------------------------------------ */
/*  ChatPanel                                                          */
/* ------------------------------------------------------------------ */

export function ChatPanel({ onNavigateToSettings }: ChatPanelProps) {
  const [slashSkillMetas, setSlashSkillMetas] = useState<SkillMeta[]>([])
  useEffect(() => {
    void window.electronAPI.skill.list().then((res) => {
      const meta = res as { success?: boolean; data?: SkillMeta[] } | undefined
      if (meta?.success && Array.isArray(meta.data)) setSlashSkillMetas(meta.data)
    })
  }, [])

  const workspaceFiles = useFileStore((s) => s.workspaceFiles)
  const editorFiles = useFileStore((s) => s.files)
  const previewPath = useFileStore((s) => s.currentFile)
  /** 工作区索引文件 + 已打开标签页去重合并，供 @ 选择 */
  const mentionFiles = useMemo(() => {
    const map = new Map<string, { path: string; name: string }>()
    for (const w of workspaceFiles) {
      const name = w.relativePath || w.path.split(/[/\\]/).pop() || w.path
      map.set(w.path, { path: w.path, name })
    }
    for (const f of editorFiles) {
      map.set(f.path, { path: f.path, name: f.name })
    }
    return [...map.values()].sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }),
    )
  }, [workspaceFiles, editorFiles])

  const isConfigured = useSettingsStore((s) => s.isConfigured)
  const agentStatus = useChatStore((s) => s.agentStatus)
  const messages = useChatStore((s) => s.messages)
  const sendMessage = useChatStore((s) => s.sendMessage)
  const startAiMessage = useChatStore((s) => s.startAiMessage)
  const appendToken = useChatStore((s) => s.appendToken)
  const appendReasoningToken = useChatStore((s) => s.appendReasoningToken)
  const addToolCallToAiMessage = useChatStore((s) => s.addToolCallToAiMessage)
  const updateToolCallResult = useChatStore((s) => s.updateToolCallResult)
  const finalizePendingToolCalls = useChatStore((s) => s.finalizePendingToolCalls)
  const setAgentStatus = useChatStore((s) => s.setAgentStatus)
  const [progressHint, setProgressHint] = useState('')
  const [workingHintIndex, setWorkingHintIndex] = useState(0)
  const [processedWriteCallIds, setProcessedWriteCallIds] = useState<Set<string>>(new Set())
  const [previewMetaByChangeId, setPreviewMetaByChangeId] = useState<Map<string, PreviewChangeData>>(new Map())
  const [reportSourceMessageId, setReportSourceMessageId] = useState<string | null>(null)

  // Editor-chat bridge for write_file preview actions
  const { previewChange, applyChange, rejectChange } = useEditorChatBridge()

  const handleApplyChange = useCallback(async (changeId: string) => {
    const result = await applyChange(changeId)
    if (result.success) {
      setPreviewMetaByChangeId((prev) => {
        const next = new Map(prev)
        next.delete(changeId)
        return next
      })
      setProcessedWriteCallIds((prev) => {
        const next = new Set(prev)
        next.add(changeId)
        return next
      })
    }
    return result
  }, [applyChange])

  const writeFilePathByChangeId = useMemo(() => {
    const map = new Map<string, string>()
    for (const msg of messages) {
      if (msg.role !== 'ai' || !msg.toolCalls) continue
      for (const tc of msg.toolCalls) {
        if (tc.name !== 'write_file' || !tc.input || typeof tc.input !== 'object') continue
        const inp = tc.input as Record<string, unknown>
        const fp = typeof inp.filePath === 'string' ? inp.filePath : ''
        if (fp) map.set(tc.id, fp)
      }
    }
    return map
  }, [messages])

  const handleRejectChange = useCallback(async (changeId: string) => {
    const result = await rejectChange(changeId)
    if (result.success) {
      setPreviewMetaByChangeId((prev) => {
        const next = new Map(prev)
        next.delete(changeId)
        return next
      })
      const fp = writeFilePathByChangeId.get(changeId)
      if (fp) {
        void useFileStore.getState().loadFileContent(fp)
      }
      setProcessedWriteCallIds((prev) => {
        const next = new Set(prev)
        next.add(changeId)
        return next
      })
    }
    return result
  }, [rejectChange, writeFilePathByChangeId])

  // Refs for stream lifecycle
  const streamUnsubRef = useRef<(() => void) | null>(null)
  const currentAiMessageIdRef = useRef<string | null>(null)
  const virtuosoRef = useRef<VirtuosoHandle>(null)
  const isAtBottomRef = useRef(true)

  /* ── Build flattened item list for Virtuoso ── */

  const items = useMemo<ChatItem[]>(() => {
    const result: ChatItem[] = []
    for (const msg of messages) {
      result.push({ type: 'message', message: msg })
      if (msg.role === 'ai' && msg.toolCalls && msg.toolCalls.length > 0) {
        for (const tc of msg.toolCalls) {
          // 检索完成后不再占用列表（用户无需看到检索参数与原始输出）
          if (tc.name === 'read_file') {
            continue
          }
          // 联网抓取属于内部检索步骤，默认不展示工具卡片。
          if (tc.name === 'fetch_webpage') {
            continue
          }
          // 写文件确认卡片：等 AI 本轮回复结束后再展示，避免中途突兀插入
          if (tc.name === 'write_file' && agentStatus !== 'idle') {
            continue
          }
          // 已确认/撤销的写入卡片从列表中移除
          if (tc.name === 'write_file' && processedWriteCallIds.has(tc.id)) {
            continue
          }
          if (tc.name === 'search_content' && tc.output !== undefined) {
            continue
          }
          result.push({ type: 'tool-call', toolCall: tc })
        }
      }
    }
    return result
  }, [messages, agentStatus, processedWriteCallIds])

  /* ── Report export: show when AI analysis complete + has tool_results ── */

  const reportInfo = useMemo<{ show: boolean; content: string }>(() => {
    if (agentStatus !== 'idle') return { show: false, content: '' }
    if (!reportSourceMessageId) return { show: false, content: '' }

    // Only show report export for the AI message completed in the current turn.
    const lastAiWithResults = messages.find(
      (m) =>
        m.id === reportSourceMessageId &&
        m.role === 'ai' &&
        m.toolCalls &&
        m.toolCalls.length > 0 &&
        m.toolCalls.some((tc) => tc.output !== undefined),
    ) as Message | undefined

    if (!lastAiWithResults) return { show: false, content: '' }

    // Only show export when the corresponding user turn explicitly requested report-style output.
    const aiIndex = messages.findIndex((m) => m.id === reportSourceMessageId)
    const prevUser =
      aiIndex > 0
        ? [...messages.slice(0, aiIndex)].reverse().find((m) => m.role === 'user')
        : undefined

    const reportRequested = hasReportIntent(prevUser?.content ?? '') || hasReportIntent(prevUser?.contextFootnote ?? '')
    if (!reportRequested) return { show: false, content: '' }

    // Build report content from the AI message
    const lines: string[] = []
    lines.push('# 日志分析报告')
    lines.push('')
    lines.push(`> 生成时间: ${new Date().toLocaleString('zh-CN')}`)
    lines.push('')
    lines.push(lastAiWithResults.content)
    lines.push('')

    // Append tool call summary as appendix
    if (lastAiWithResults.toolCalls && lastAiWithResults.toolCalls.length > 0) {
      lines.push('---')
      lines.push('')
      lines.push('## 附录：分析工具调用记录')
      lines.push('')
      for (const tc of lastAiWithResults.toolCalls) {
        if (tc.name === 'search_content') continue
        lines.push(`### \`${tc.name}\``)
        if (tc.output !== undefined) {
          const outputText =
            typeof tc.output === 'string' ? tc.output : JSON.stringify(tc.output, null, 2)
          lines.push('')
          lines.push('```')
          lines.push(outputText.length > 2000 ? outputText.slice(0, 2000) + '\n...(truncated)' : outputText)
          lines.push('```')
        } else {
          lines.push('')
          lines.push('_(未返回结果)_')
        }
        lines.push('')
      }
    }

    return { show: true, content: lines.join('\n') }
  }, [agentStatus, messages, reportSourceMessageId])

  /* ── Is the last AI message still streaming? ── */

  const lastMessage = messages[messages.length - 1]
  const isStreaming =
    (agentStatus === 'streaming' || agentStatus === 'running') &&
    lastMessage?.role === 'ai'

  /* ── Stream event handler ── */

  const handleStreamEvent = useCallback(
    (data: string) => {
      const event = parseStreamEvent(data)
      console.debug('[agent:stream]', event)

      switch (event.type) {
        case 'text_delta': {
          // Ensure we have an AI message to append to
          if (!currentAiMessageIdRef.current) {
            currentAiMessageIdRef.current = startAiMessage()
          }
          appendToken(currentAiMessageIdRef.current, event.text)
          break
        }

        case 'reasoning_delta': {
          if (!currentAiMessageIdRef.current) {
            currentAiMessageIdRef.current = startAiMessage()
          }
          appendReasoningToken(currentAiMessageIdRef.current, event.text)
          break
        }

        case 'tool_use': {
          // Ensure we have an AI message
          if (!currentAiMessageIdRef.current) {
            currentAiMessageIdRef.current = startAiMessage()
          }
          addToolCallToAiMessage(currentAiMessageIdRef.current, {
            id: event.id,
            name: event.name,
            input: event.input,
          })

          // write_file：注册待确认写入（确认后才真正落盘）
          if (event.name === 'write_file' && event.input && typeof event.input === 'object') {
            const inp = event.input as Record<string, unknown>
            const filePath = typeof inp.filePath === 'string' ? inp.filePath : ''
            const newContent = typeof inp.content === 'string' ? inp.content : undefined
            const transactionId = typeof inp.transactionId === 'string' ? inp.transactionId : undefined
            const editsRaw = Array.isArray(inp.edits) ? inp.edits : undefined
            const edits = editsRaw
              ?.map((e) => {
                if (!e || typeof e !== 'object') return null
                const row = e as Record<string, unknown>
                const startLine = Number(row.startLine)
                const endLine = Number(row.endLine)
                const newText = typeof row.newText === 'string' ? row.newText : ''
                if (!Number.isFinite(startLine) || !Number.isFinite(endLine)) return null
                return {
                  startLine: Math.floor(startLine),
                  endLine: Math.floor(endLine),
                  newText,
                }
              })
              .filter((e): e is { startLine: number; endLine: number; newText: string } => Boolean(e))
            if (filePath) {
              void previewChange({
                changeId: event.id,
                filePath,
                newContent,
                edits,
                transactionId,
              }).then((res) => {
                const data = res.data
                if (!res.success || !data) return
                setPreviewMetaByChangeId((prev) => {
                  const next = new Map(prev)
                  next.set(event.id, data)
                  return next
                })
              })
            }
          }
          break
        }

        case 'tool_result': {
          const msgId = currentAiMessageIdRef.current
          if (msgId) {
            updateToolCallResult(msgId, event.id, event.content, event.isError)
          }
          break
        }

        case 'done': {
          const completedMsgId = currentAiMessageIdRef.current
          if (completedMsgId) {
            setReportSourceMessageId(completedMsgId)
          }
          setAgentStatus('idle')
          setProgressHint('')
          currentAiMessageIdRef.current = null
          // Unsubscribe stream
          if (streamUnsubRef.current) {
            streamUnsubRef.current()
            streamUnsubRef.current = null
          }
          break
        }

        case 'error': {
          setAgentStatus('error')
          setProgressHint('')
          // Append error to current AI message if one exists
          const msgId = currentAiMessageIdRef.current
          if (msgId) {
            appendToken(msgId, `\n\n[Error: ${event.message}]`)
            finalizePendingToolCalls(msgId, event.message)
          }
          currentAiMessageIdRef.current = null
          // Unsubscribe stream
          if (streamUnsubRef.current) {
            streamUnsubRef.current()
            streamUnsubRef.current = null
          }
          break
        }

        case 'status': {
          // Handle restarting status
          if (event.status === 'restarting') {
            setAgentStatus('restarting')
          } else if (event.status === 'running' || event.status === 'streaming') {
            setAgentStatus(event.status)
          } else if (event.status === 'idle') {
            setAgentStatus('idle')
            setProgressHint('')
          }
          break
        }

        case 'progress': {
          const sec = event.elapsedMs !== undefined ? ` (${Math.floor(event.elapsedMs / 1000)}s)` : ''
          const text = `${event.message}${sec}`
          setProgressHint(text)
          break
        }
      }
    },
    [
      startAiMessage,
      appendToken,
      appendReasoningToken,
      addToolCallToAiMessage,
      previewChange,
      updateToolCallResult,
      finalizePendingToolCalls,
      setAgentStatus,
    ],
  )

  /* ── Build IPC context：默认仅当前预览/激活文件（无 @ 或未打开标签时不混入其它已打开标签正文） ── */

  const MAX_TAB_READ_CHARS = 500_000

  const buildAgentContextAsync = useCallback(async () => {
    const currentFile = useFileStore.getState().currentFile
    const files = useFileStore.getState().files
    const { content, selectedText } = useEditorStore.getState()

    let openFiles: Array<{
      path: string
      content?: string
      selectedText?: string
    }> = []

    if (currentFile) {
      const isOpenTab = files.some((f) => f.path === currentFile)
      if (isOpenTab) {
        openFiles = [
          {
            path: currentFile,
            content,
            selectedText: selectedText ?? undefined,
          },
        ]
      } else {
        try {
          const res = (await window.electronAPI.file.read(currentFile)) as {
            success?: boolean
            data?: { content?: string }
          }
          const raw =
            res?.success && res.data?.content !== undefined ? res.data.content : undefined
          openFiles = [
            {
              path: currentFile,
              content: raw !== undefined ? raw.slice(0, MAX_TAB_READ_CHARS) : undefined,
              selectedText: undefined,
            },
          ]
        } catch {
          openFiles = [
            {
              path: currentFile,
              content: undefined,
              selectedText: undefined,
            },
          ]
        }
      }
    }

    const history = useChatStore.getState().messages.map((m) => {
      if (m.role === 'user') {
        return { role: 'user' as const, content: m.content }
      }
      return {
        role: 'assistant' as const,
        content: m.content,
        reasoningContent: m.reasoningContent,
      }
    })

    return { openFiles, history }
  }, [])

  /* ── Send message ── */

  const handleSend = useCallback(
    async (
      text: string,
      opts?: { attachmentPaths?: string[]; skillInvocations?: string[] },
    ) => {
      // 新一轮输入开始时，历史写入卡片（未处理）全部作废，避免旧弹窗再次出现。
      {
        const staleWriteIds = useChatStore
          .getState()
          .messages.flatMap((m) =>
            m.role === 'ai'
              ? (m.toolCalls ?? [])
                  .filter((tc) => tc.name === 'write_file')
                  .map((tc) => tc.id)
              : [],
          )
        if (staleWriteIds.length > 0) {
          setProcessedWriteCallIds((prev) => {
            const next = new Set(prev)
            for (const id of staleWriteIds) next.add(id)
            return next
          })
          setPreviewMetaByChangeId((prev) => {
            const next = new Map(prev)
            for (const id of staleWriteIds) {
              next.delete(id)
            }
            return next
          })
        }
      }

      // Cancel any existing stream
      if (currentAiMessageIdRef.current) {
        finalizePendingToolCalls(currentAiMessageIdRef.current, '新的请求已开始，上一轮已中断')
      }
      void window.electronAPI.agent.cancel()
      if (streamUnsubRef.current) {
        streamUnsubRef.current()
        streamUnsubRef.current = null
      }
      currentAiMessageIdRef.current = null
      setReportSourceMessageId(null)
      setProgressHint('正在准备上下文...')
      setWorkingHintIndex(0)

      const listRes = (await window.electronAPI.skill.list()) as {
        success?: boolean
        data?: SkillMeta[]
      }
      const knownList = listRes?.success && Array.isArray(listRes.data) ? listRes.data : []
      setSlashSkillMetas(knownList)
      const fromChips = opts?.skillInvocations ?? []
      const fromText = extractSlashSkillNames(text)
      const explicitSkillNames = [...new Set([...fromChips, ...fromText])]
      let llmBody = stripSlashSkillTokens(text, explicitSkillNames)
      if (!llmBody.trim() && explicitSkillNames.length > 0) {
        llmBody = '（已按 /Skill 调用注入技能说明，请遵照 Skill 内容协助处理。）'
      }

      const base = await buildAgentContextAsync()
      let preface = ''
      const quotes = useChatStore.getState().quotes
      const currentPath = useFileStore.getState().currentFile
      const quoteBasename = currentPath
        ? currentPath.split(/[/\\]/).pop() ?? currentPath
        : undefined
      const attachmentPaths = opts?.attachmentPaths ?? []

      const fsState = useFileStore.getState()
      const workspaceRoot = fsState.workspaceRoot
      const writableRootsExtra = new Set<string>()
      for (const f of fsState.files) {
        writableRootsExtra.add(parentDir(f.path))
      }
      for (const p of attachmentPaths) {
        writableRootsExtra.add(parentDir(p))
      }

      const footnoteParts: string[] = []
      if (quotes.length > 0) {
        for (const q of quotes) {
          const label = q.sourceLabel ?? quoteBasename ?? '编辑器'
          const range = q.range ? `#${q.range.startLine}-${q.range.endLine}` : ''
          footnoteParts.push(`@${label}${range}`)
        }
      }
      for (const n of explicitSkillNames) {
        footnoteParts.push(`/${n}`)
      }
      for (const p of attachmentPaths) {
        footnoteParts.push(`@${p.split(/[/\\]/).pop() ?? p}`)
      }
      const contextFootnote = footnoteParts.length > 0 ? footnoteParts.join(' · ') : undefined

      if (quotes.length > 0) {
        const quoteBlocks = quotes.map((q, i) => {
          const label = q.sourceLabel ?? quoteBasename ?? '编辑器'
          const range = q.range ? `#${q.range.startLine}-${q.range.endLine}` : ''
          return `【引用选区 ${i + 1}：@${label}${range}】\n\`\`\`\n${q.text}\n\`\`\``
        })
        preface += quoteBlocks.join('\n\n')
        useChatStore.getState().clearQuotes()
      }
      for (const p of attachmentPaths) {
        try {
          const res = (await window.electronAPI.file.read(p)) as {
            success?: boolean
            data?: { content?: string }
          }
          const c =
            res?.success && res.data?.content !== undefined ? res.data.content : ''
          const block = `【@${p}】\n\`\`\`\n${c.slice(0, 120000)}\n\`\`\``
          preface += preface ? `\n\n${block}` : block
        } catch {
          const err = `【@${p}】(读取失败)`
          preface += preface ? `\n\n${err}` : err
        }
      }

      const context = {
        ...base,
        preface: preface.trim() || undefined,
        explicitSkillNames:
          explicitSkillNames.length > 0 ? explicitSkillNames : undefined,
        workspaceRoot,
        writableRootsExtra: [...writableRootsExtra],
      }

      const shouldStickBottomAfterSend = isAtBottomRef.current

      // Add user message to store（气泡与发给模型的正文均为去掉 /技能名 标记后的文案）
      sendMessage(llmBody, contextFootnote ? { contextFootnote } : undefined)

      if (shouldStickBottomAfterSend) {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            virtuosoRef.current?.scrollToIndex({
              index: 'LAST',
              align: 'end',
              behavior: 'auto',
            })
          })
        })
      }

      // Subscribe to stream BEFORE calling send
      streamUnsubRef.current = window.electronAPI.agent.onStream(handleStreamEvent)

      // Fire and forget — results come via stream
      window.electronAPI.agent.send(llmBody, context).catch((err) => {
        console.error('agent.send error:', err)
        // If send itself fails, clean up
        setAgentStatus('error')
        setProgressHint('')
        if (currentAiMessageIdRef.current) {
          finalizePendingToolCalls(
            currentAiMessageIdRef.current,
            err instanceof Error ? err.message : String(err),
          )
        }
        if (streamUnsubRef.current) {
          streamUnsubRef.current()
          streamUnsubRef.current = null
        }
      })
    },
    [
      sendMessage,
      handleStreamEvent,
      buildAgentContextAsync,
      setAgentStatus,
      finalizePendingToolCalls,
    ],
  )

  /* ── Cancel ── */

  const handleCancel = useCallback(() => {
    window.electronAPI.agent.cancel()
    if (currentAiMessageIdRef.current) {
      finalizePendingToolCalls(currentAiMessageIdRef.current, '用户取消了本次请求')
    }
    if (streamUnsubRef.current) {
      streamUnsubRef.current()
      streamUnsubRef.current = null
    }
    setProgressHint('')
    setAgentStatus('idle')
    currentAiMessageIdRef.current = null
  }, [setAgentStatus, finalizePendingToolCalls])

  /* ── Suggestion chip handler ── */

  const handleSuggestionSelect = useCallback(
    (text: string) => {
      handleSend(text)
    },
    [handleSend],
  )

  /* ── Cleanup on unmount ── */

  useEffect(() => {
    return () => {
      void window.electronAPI.agent.cancel()
      if (streamUnsubRef.current) {
        streamUnsubRef.current()
        streamUnsubRef.current = null
      }
    }
  }, [])

  const isRunning = agentStatus === 'running' || agentStatus === 'streaming'

  const latestAiMessage = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'ai') return messages[i]
    }
    return null
  }, [messages])

  const latestAiHasVisibleText = Boolean(latestAiMessage?.content?.trim())

  const latestAiHasVisibleTools = Boolean(
    latestAiMessage?.toolCalls?.some((tc) => {
      if (tc.name === 'read_file') return false
      if (tc.name === 'fetch_webpage') return false
      if (tc.name === 'search_content' && tc.output !== undefined) return false
      return true
    }),
  )

  const shouldRotateStatusHints =
    agentStatus === 'running' ||
    agentStatus === 'streaming' ||
    agentStatus === 'restarting'
  const shouldForceFollowLatest =
    agentStatus === 'running' ||
    agentStatus === 'streaming' ||
    agentStatus === 'restarting'

  const streamScrollFingerprint =
    (lastMessage?.content?.length ?? 0) +
    (lastMessage?.reasoningContent?.length ?? 0) +
    (lastMessage?.toolCalls?.length ?? 0) +
    items.length

  useEffect(() => {
    if (!shouldForceFollowLatest || items.length === 0) return
    const id = requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        virtuosoRef.current?.scrollToIndex({
          index: 'LAST',
          align: 'end',
          behavior: 'auto',
        })
      })
    })
    return () => cancelAnimationFrame(id)
  }, [shouldForceFollowLatest, streamScrollFingerprint, items.length])

  useEffect(() => {
    if (!shouldForceFollowLatest) return
    const stickToBottom = () => {
      virtuosoRef.current?.scrollToIndex({
        index: 'LAST',
        align: 'end',
        behavior: 'auto',
      })
    }
    stickToBottom()
    const timer = window.setInterval(stickToBottom, 120)
    return () => window.clearInterval(timer)
  }, [shouldForceFollowLatest])

  const rotatingHint = WORKING_HINTS[workingHintIndex % WORKING_HINTS.length]
  const headerStatusText = shouldRotateStatusHints
    ? rotatingHint
    : (agentStatus === 'idle' ? '就绪' : STATUS_LABELS[agentStatus] || '就绪')

  useEffect(() => {
    if (!shouldRotateStatusHints) return
    const timer = window.setInterval(() => {
      setWorkingHintIndex((prev) => prev + 1)
    }, 2500)
    return () => window.clearInterval(timer)
  }, [shouldRotateStatusHints])

  /* ══════════════════════════════════════════════════════════════════ */
  /*  Configured-state render                                           */
  /* ══════════════════════════════════════════════════════════════════ */

  if (!isConfigured) {
    return (
      <aside className="chat-panel flex flex-col items-center justify-center p-6">
        {/* Icon */}
        <div className="w-12 h-12 rounded-full bg-[var(--bg-card)] flex items-center justify-center mb-4">
          <svg
            width="22"
            height="22"
            viewBox="0 0 24 24"
            fill="none"
            stroke="var(--text-tertiary)"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M12 2a10 10 0 1010 10A10 10 0 0012 2z" />
            <path d="M8.56 2.75c4.37 6.03 6.02 9.42 8.03 17.72M19.13 5.09c-3.47 2.63-9.31 2.16-13.73 4.89" />
            <path d="M22 12h-4" />
            <path d="M2 12h4" />
          </svg>
        </div>

        <p className="text-app text-[var(--text-secondary)] font-medium mb-1">
          请先配置 AI 提供商
        </p>
        <p className="text-app-sm text-[var(--text-hint)] text-center mb-4 leading-relaxed">
          需要配置至少一个 AI 提供商才能使用 AI 对话功能。
        </p>

        {/* Disabled input visual */}
        <div className="w-full bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded-[var(--radius-sm)] px-3 py-2 mb-4 opacity-50">
          <span className="text-app-sm text-[var(--text-hint)]">输入消息...</span>
        </div>

        {onNavigateToSettings && (
          <button
            type="button"
            onClick={onNavigateToSettings}
            className="flex items-center gap-2 px-4 py-2.5 text-app rounded-[var(--radius-sm)] bg-[var(--accent)] text-white hover:bg-[var(--accent-hover)] transition-colors font-medium"
          >
            <Settings size={16} strokeWidth={2} aria-hidden />
            前往设置
          </button>
        )}
      </aside>
    )
  }

  /* ══════════════════════════════════════════════════════════════════ */
  /*  Configured — full chat UI                                         */
  /* ══════════════════════════════════════════════════════════════════ */

  const showSuggestions = messages.length === 0 && !isRunning

  return (
    <aside className="chat-panel">
      {/* Header — matches Pencil: "AI 对话" + status dot + text */}
      <div className="chat-header">
        <p className="chat-header-title">AI 对话</p>
        <span
          className={`chat-header-status-dot ${shouldRotateStatusHints ? 'status-dot-pulse' : ''}`}
          style={{ backgroundColor: agentStatus === 'idle' ? 'var(--success)' : 'var(--accent)' }}
        />
        <span className="chat-header-status-text">
          {headerStatusText}
        </span>
      </div>

      {/* Messages area */}
      <div className="chat-messages-area">
        {messages.length === 0 && !isRunning ? (
          /* Empty state */
          <div className="flex-1 flex flex-col items-center justify-center p-6">
            <p className="text-xs text-[var(--text-hint)] mb-4">开始与 AI 对话</p>
            <SuggestionChips onSelect={handleSuggestionSelect} />
          </div>
        ) : (
          /* Virtual list of messages */
          <Virtuoso
            ref={virtuosoRef}
            data={items}
            followOutput={() =>
              shouldForceFollowLatest
                ? 'auto'
                : (isAtBottomRef.current ? 'smooth' : false)
            }
            atBottomStateChange={(atBottom) => {
              isAtBottomRef.current = atBottom
            }}
            alignToBottom
            increaseViewportBy={{ bottom: 160, top: 0 }}
            className="chat-virtuoso"
            components={{
              Footer: () => <div className="chat-virtuoso-footer-spacer" aria-hidden />,
            }}
            itemContent={(index, item) => {
              const mb = marginBottomAfterItem(items, index)
              const gapStyle = mb > 0 ? ({ marginBottom: mb } as const) : undefined

              if (item.type === 'message') {
                const isEmptyAiMessage =
                  item.message.role === 'ai' &&
                  !item.message.content.trim()
                const hasVisibleToolCalls =
                  item.message.role === 'ai' &&
                  Boolean(
                    item.message.toolCalls?.some((tc) => {
                      if (tc.name === 'read_file') return false
                      if (tc.name === 'fetch_webpage') return false
                      if (tc.name === 'search_content' && tc.output !== undefined) return false
                      if (tc.name === 'write_file' && agentStatus !== 'idle') return false
                      if (tc.name === 'write_file' && processedWriteCallIds.has(tc.id)) return false
                      return true
                    }),
                  )
                if (isEmptyAiMessage) {
                  if (hasVisibleToolCalls) {
                    return (
                      <div className="chat-list-item" style={gapStyle}>
                        <div className="msg-row msg-row--ai">
                          <div className="msg-ai-tool-anchor">AI 文件修改建议</div>
                        </div>
                      </div>
                    )
                  }
                  return null
                }
                const isLastAi =
                  item.message.id === lastMessage?.id &&
                  item.message.role === 'ai'
                return (
                  <div className="chat-list-item" style={gapStyle}>
                    <MessageLine
                      message={item.message}
                      isStreaming={isLastAi && isStreaming}
                    />
                  </div>
                )
              }
              if (item.type === 'tool-call') {
                if (item.toolCall.name === 'search_content') {
                  return (
                    <div className="chat-list-item" style={gapStyle}>
                      <div className="msg-row msg-row--tool">
                        <div className="msg-tool-wrap msg-tool-wrap--quiet">
                          <QuietSearchToolRow toolCall={item.toolCall} />
                        </div>
                      </div>
                    </div>
                  )
                }
                return (
                  <div className="chat-list-item" style={gapStyle}>
                    <div className="msg-row msg-row--tool">
                      <div className="msg-tool-wrap">
                        <ToolCallCard
                          toolCall={item.toolCall}
                          previewMeta={previewMetaByChangeId.get(item.toolCall.id)}
                          onApplyChange={handleApplyChange}
                          onRejectChange={handleRejectChange}
                        />
                      </div>
                    </div>
                  </div>
                )
              }
              return null
            }}
          />
        )}
      </div>

      {/* Report export button — appears after analysis completes with tool results */}
      {reportInfo.show && <ReportExport content={reportInfo.content} />}

      {/* Suggestion chips shown above input when there are messages */}
      {showSuggestions && messages.length === 0 && !isRunning && (
        <SuggestionChips onSelect={handleSuggestionSelect} />
      )}

      {/* Input area */}
      <ChatInput
        onSend={handleSend}
        onCancel={handleCancel}
        isRunning={isRunning}
        mentionFiles={mentionFiles}
        quoteSourceLabel={previewPath ? previewPath.split(/[/\\]/).pop() : undefined}
        slashSkills={slashSkillMetas}
      />
    </aside>
  )
}
