import { useRef, useEffect, useCallback, useMemo, useState } from 'react'
import { Settings } from 'lucide-react'
import { Virtuoso } from 'react-virtuoso'
import type { VirtuosoHandle } from 'react-virtuoso'

import { useSettingsStore } from '../../stores/settingsStore'
import { useChatStore } from '../../stores/chatStore'
import { useSessionContextStore } from '../../stores/sessionContextStore'
import { useFileStore } from '../../stores/fileStore'
import { normalizeDocumentPath, useEditorStore } from '../../stores/editorStore'
import { useReviewStore } from '../../stores/reviewStore'
import type { AgentStatus, Message } from '../../stores/chatStore'

import { MessageLine } from './MessageLine'
import { ToolCallCard } from './ToolCallCard'
import { SuggestionChips } from './SuggestionChips'
import { ChatInput } from './ChatInput'
import { ChatContextBar } from './ChatContextBar'
import { PinnedFactsBar } from './PinnedFactsBar'
import { ReportExport } from '../export/ReportExport'
import { useEditorChatBridge } from '../../hooks/useEditorChatBridge'
import type { PreviewChangeData } from '../../hooks/useEditorChatBridge'
import { marginBottomAfterItem, type ChatItem } from './chatListSpacing'
import { QuietSearchToolRow } from './QuietSearchToolRow'
import type { SkillMeta } from '../../../../shared/types'
import {
  buildExportReportContent,
  reportIntentForAiMessage,
} from '../../utils/reportExportBuild'
import { FluxToast, type FluxToastState } from '../common/FluxToast'
import {
  AUTO_COMPRESS_BLOCK_PCT,
  AUTO_COMPRESS_HARD_PCT,
  AUTO_COMPRESS_SOFT_PCT,
  LARGE_FILE_NO_INJECT_BYTES,
  MAX_REQUEST_INPUT_CHARS,
  MAX_OPEN_FILE_INJECT_CHARS,
  MAX_PREFACE_SINGLE_CHARS,
  MAX_QUOTE_CHARS,
  clampPreface,
  estimateInputChars,
  formatLargeFileMetadata,
} from '../../../../shared/context-budget'
import { shouldAutoCompress } from '../../../../shared/history-compress'
import type { FileInfo } from '../../../../shared/types'
import { buildReviewAgentContext, shouldInjectReviewContext } from '../../utils/reviewAgentContext'
import { parseValidatedWritePreview } from '../../utils/writePreviewPayload'

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

/** 用于 write_file 允许的目录前缀（与主进程 path.dirname 一致语义） */
function parentDir(filePath: string): string {
  const m = filePath.match(/^(.*)[/\\][^/\\]+$/)
  return m ? m[1]! : filePath
}

async function fetchFileInfo(filePath: string): Promise<FileInfo | null> {
  try {
    const res = (await window.electronAPI.file.getInfo(filePath)) as {
      success?: boolean
      data?: FileInfo
    }
    return res?.success && res.data ? res.data : null
  } catch {
    return null
  }
}

function showContextWarnings(
  warnings: string[],
  setToast: (t: FluxToastState | null) => void,
): void {
  if (warnings.length === 0) return
  const message =
    warnings.length === 1
      ? warnings[0]!
      : `${warnings[0]}（另有 ${warnings.length - 1} 条上下文提示）`
  setToast({ message, variant: 'warn' })
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
      if (w.kind === 'directory') continue
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
  const summarizeToolOutputs = useChatStore((s) => s.summarizeToolOutputs)
  const setAgentStatus = useChatStore((s) => s.setAgentStatus)
  const quotesForBar = useChatStore((s) => s.quotes)
  const workingSummary = useSessionContextStore((s) => s.workingSummary)
  const compressFromMessages = useSessionContextStore((s) => s.compressFromMessages)
  const getHistoryForApi = useSessionContextStore((s) => s.getHistoryForApi)
  const autoCompressHistory = useSessionContextStore((s) => s.autoCompressHistory)
  const pinFromMessageContent = useSessionContextStore((s) => s.pinFromMessageContent)
  const isFactPinned = useSessionContextStore((s) => s.isFactPinned)
  const persistWorkspaceSession = useSessionContextStore((s) => s.persistWorkspaceSession)
  const appendMessageEvent = useSessionContextStore((s) => s.appendMessageEvent)
  const compactAndPersist = useSessionContextStore((s) => s.compactAndPersist)
  const pinnedFacts = useSessionContextStore((s) => s.pinnedFacts)
  const [progressHint, setProgressHint] = useState('')
  const [workingHintIndex, setWorkingHintIndex] = useState(0)
  const [processedWriteCallIds, setProcessedWriteCallIds] = useState<Set<string>>(new Set())
  const [previewMetaByChangeId, setPreviewMetaByChangeId] = useState<Map<string, PreviewChangeData>>(new Map())
  const [reportSourceMessageId, setReportSourceMessageId] = useState<string | null>(null)
  const [contextToast, setContextToast] = useState<FluxToastState | null>(null)
  const [isAutoCompressing, setIsAutoCompressing] = useState(false)
  const [draftStats, setDraftStats] = useState({ textChars: 0, attachmentChars: 0, skillCount: 0 })

  useEffect(() => {
    void useSessionContextStore.getState().scheduleCleanup()
  }, [])

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
  const pendingTextRef = useRef('')
  const pendingReasoningRef = useRef('')
  const flushTimerRef = useRef<number | null>(null)
  const virtuosoRef = useRef<VirtuosoHandle>(null)
  const isAtBottomRef = useRef(true)

  const flushBufferedTokens = useCallback(() => {
    if (flushTimerRef.current !== null) {
      window.clearTimeout(flushTimerRef.current)
      flushTimerRef.current = null
    }

    if (!pendingTextRef.current && !pendingReasoningRef.current) {
      return
    }

    if (!currentAiMessageIdRef.current) {
      currentAiMessageIdRef.current = startAiMessage()
    }

    const msgId = currentAiMessageIdRef.current
    if (!msgId) return

    if (pendingTextRef.current) {
      appendToken(msgId, pendingTextRef.current)
      pendingTextRef.current = ''
    }
    if (pendingReasoningRef.current) {
      appendReasoningToken(msgId, pendingReasoningRef.current)
      pendingReasoningRef.current = ''
    }
  }, [appendReasoningToken, appendToken, startAiMessage])

  const scheduleBufferedFlush = useCallback(() => {
    if (flushTimerRef.current !== null) return
    flushTimerRef.current = window.setTimeout(() => {
      flushTimerRef.current = null
      flushBufferedTokens()
    }, 40)
  }, [flushBufferedTokens])

  /* ── Build flattened item list for Virtuoso ── */

  const items = useMemo<ChatItem[]>(() => {
    const result: ChatItem[] = []
    for (const msg of messages) {
      result.push({ type: 'message', message: msg })
      if (msg.role === 'ai' && msg.toolCalls && msg.toolCalls.length > 0) {
        const { reportRequested, problemSummaryRequested } = reportIntentForAiMessage(
          messages,
          msg.id,
        )
        const suppressReportWrites = reportRequested || problemSummaryRequested

        for (const tc of msg.toolCalls) {
          // 文件读取/文件信息属于内部检索步骤，默认不展示工具卡片。
          if (tc.name === 'read_file' || tc.name === 'get_file_info') {
            continue
          }
          // 联网抓取属于内部检索步骤，默认不展示工具卡片。
          if (tc.name === 'fetch_webpage') {
            continue
          }
          // 报告场景：不展示 write_file（交付由「导出报告」完成，方案 A）
          if (tc.name === 'write_file' && suppressReportWrites) {
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

  const reportInfo = useMemo<{ show: boolean; content: string; defaultName: string; buttonLabel: string }>(() => {
    if (agentStatus !== 'idle') return { show: false, content: '', defaultName: 'analysis-report.md', buttonLabel: '导出报告' }
    if (!reportSourceMessageId) return { show: false, content: '', defaultName: 'analysis-report.md', buttonLabel: '导出报告' }

    const currentAiMessage = messages.find(
      (m) => m.id === reportSourceMessageId && m.role === 'ai',
    ) as Message | undefined

    if (!currentAiMessage) {
      return { show: false, content: '', defaultName: 'analysis-report.md', buttonLabel: '导出报告' }
    }

    const { reportRequested, problemSummaryRequested } = reportIntentForAiMessage(
      messages,
      reportSourceMessageId,
    )

    if (!reportRequested && !problemSummaryRequested) {
      return { show: false, content: '', defaultName: 'analysis-report.md', buttonLabel: '导出报告' }
    }

    const exportContent = buildExportReportContent(currentAiMessage, {
      problemSummaryRequested,
      previewMetaByChangeId,
    })

    if (!exportContent) {
      return { show: false, content: '', defaultName: 'analysis-report.md', buttonLabel: '导出报告' }
    }

    return {
      show: true,
      content: exportContent,
      defaultName: problemSummaryRequested ? 'problem-summary.md' : 'analysis-report.md',
      buttonLabel: '导出报告',
    }
  }, [agentStatus, messages, reportSourceMessageId, previewMetaByChangeId])

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
          pendingTextRef.current += event.text
          scheduleBufferedFlush()
          break
        }

        case 'reasoning_delta': {
          pendingReasoningRef.current += event.text
          scheduleBufferedFlush()
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

          break
        }

        case 'tool_result': {
          const msgId = currentAiMessageIdRef.current
          if (msgId) {
            updateToolCallResult(msgId, event.id, event.content, event.isError)
          }
          // 主进程执行 write_file 并通过路径校验后，才登记渲染侧的待确认写入。
          // 不能在 tool_use 阶段预览：那时的参数仍完全来自模型，尚未经过安全边界验证。
          if (!event.isError) {
            const toolCall = useChatStore.getState().messages
              .find((message) => message.id === msgId)
              ?.toolCalls?.find((call) => call.id === event.id && call.name === 'write_file')
            const payload = toolCall ? parseValidatedWritePreview(event.content) : null
            if (payload) {
              void previewChange({ changeId: event.id, ...payload }).then((res) => {
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

        case 'done': {
          flushBufferedTokens()
          const completedMsgId = currentAiMessageIdRef.current
          if (completedMsgId) {
            setReportSourceMessageId(completedMsgId)
            // 报告场景：自动忽略误触发的 write_file，避免展示大段 diff 卡片
            const snapshot = useChatStore.getState().messages
            const { reportRequested, problemSummaryRequested } = reportIntentForAiMessage(
              snapshot,
              completedMsgId,
            )
            if (reportRequested || problemSummaryRequested) {
              const aiMsg = snapshot.find((m) => m.id === completedMsgId && m.role === 'ai')
              const writeIds =
                aiMsg?.toolCalls?.filter((tc) => tc.name === 'write_file').map((tc) => tc.id) ?? []
              if (writeIds.length > 0) {
                setProcessedWriteCallIds((prev) => {
                  const next = new Set(prev)
                  for (const id of writeIds) next.add(id)
                  return next
                })
                setPreviewMetaByChangeId((prev) => {
                  const next = new Map(prev)
                  for (const id of writeIds) next.delete(id)
                  return next
                })
              }
            }
            const completedMessage = snapshot.find((message) => message.id === completedMsgId)
            const workspaceRoot = useFileStore.getState().workspaceRoot
            if (workspaceRoot && completedMessage?.content.trim()) {
              void appendMessageEvent(workspaceRoot, completedMessage)
            }
          }
          setAgentStatus('idle')
          setProgressHint('')
          summarizeToolOutputs()
          currentAiMessageIdRef.current = null
          // Unsubscribe stream
          if (streamUnsubRef.current) {
            streamUnsubRef.current()
            streamUnsubRef.current = null
          }
          break
        }

        case 'error': {
          flushBufferedTokens()
          setAgentStatus('error')
          setProgressHint('')
          // Append error to current AI message if one exists
          const msgId = currentAiMessageIdRef.current
          if (msgId) {
            appendToken(msgId, `\n\n[Error: ${event.message}]`)
            finalizePendingToolCalls(msgId, event.message)
          }
          currentAiMessageIdRef.current = null
          summarizeToolOutputs()
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
          if (event.stage === 'context_budget') {
            setContextToast({ message: event.message, variant: 'warn' })
          }
          break
        }
      }
    },
    [
      appendToken,
      appendReasoningToken,
      addToolCallToAiMessage,
      previewChange,
      updateToolCallResult,
      finalizePendingToolCalls,
      flushBufferedTokens,
      scheduleBufferedFlush,
      setAgentStatus,
      summarizeToolOutputs,
      appendMessageEvent,
    ],
  )

  /* ── Build IPC context：默认仅当前预览/激活文件（无 @ 或未打开标签时不混入其它已打开标签正文） ── */

  const buildAgentContextAsync = useCallback(async () => {
    const currentFile = useFileStore.getState().currentFile
    const files = useFileStore.getState().files
    const { content, selectedText } = useEditorStore.getState()

    let openFiles: Array<{
      path: string
      content?: string
      selectedText?: string
      sizeBytes?: number
      lines?: number
      encoding?: string
    }> = []

    if (currentFile) {
      const info = await fetchFileInfo(currentFile)
      const sizeBytes = info?.size ?? 0
      const isOpenTab = files.some((f) => f.path === currentFile)

      let injectContent: string | undefined
      if (sizeBytes > LARGE_FILE_NO_INJECT_BYTES) {
        injectContent = undefined
      } else if (isOpenTab) {
        injectContent = content.slice(0, MAX_OPEN_FILE_INJECT_CHARS)
      } else {
        try {
          const res = (await window.electronAPI.file.read(currentFile)) as {
            success?: boolean
            data?: { content?: string }
          }
          const raw =
            res?.success && res.data?.content !== undefined ? res.data.content : undefined
          injectContent = raw?.slice(0, MAX_OPEN_FILE_INJECT_CHARS)
        } catch {
          injectContent = undefined
        }
      }

      openFiles = [
        {
          path: currentFile,
          content: injectContent,
          selectedText: selectedText ?? undefined,
          sizeBytes: info?.size,
          lines: info?.lines,
          encoding: info?.encoding,
        },
      ]
    }

    const history = useSessionContextStore
      .getState()
      .getHistoryForApi(useChatStore.getState().messages)
      .map((m) => {
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
      if (isAutoCompressing) {
        setContextToast({ message: '正在压缩上下文，请稍候再发送', variant: 'warn' })
        return
      }

      const runAutoCompression = async (reason: string): Promise<void> => {
        setIsAutoCompressing(true)
        setContextToast({ message: '正在压缩上下文…', variant: 'warn' })
        const msgs = useChatStore.getState().messages
        const summary = compressFromMessages(msgs)
        const root = useFileStore.getState().workspaceRoot
        let ok = true
        if (root) {
          ok = await persistWorkspaceSession(root, true)
        }
        setContextToast({
          message: ok
            ? summary
              ? `已自动压缩（${reason}，摘要 ${summary.length.toLocaleString()} 字符）`
              : `已自动压缩（${reason}）`
            : `已自动压缩（${reason}，保存失败）`,
          variant: ok ? 'success' : 'warn',
        })
        setIsAutoCompressing(false)
      }

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
        flushBufferedTokens()
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

      const prefaceWarnings: string[] = []
      const snapshotMessages = useChatStore.getState().messages
      if (
        autoCompressHistory &&
        shouldAutoCompress(
          snapshotMessages.map((m) => ({
            id: m.id,
            role: m.role,
            content: m.content,
            reasoningContent: m.reasoningContent,
          })),
          true,
        )
      ) {
        await runAutoCompression('历史过长')
        prefaceWarnings.push('已自动压缩较早对话以控制上下文')
      }

      let base = await buildAgentContextAsync()
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
      let reviewContext: string | null = null
      if (currentPath && shouldInjectReviewContext(llmBody, explicitSkillNames)) {
        const reviewDocument = useReviewStore.getState().documents[normalizeDocumentPath(currentPath)]
        reviewContext = buildReviewAgentContext(currentPath, reviewDocument?.sidecar.comments ?? [])
        if (reviewContext) {
          const openCount = reviewDocument!.sidecar.comments.filter((comment) => comment.status === 'open').length
          footnoteParts.push(`@批注(${openCount})`)
        }
      }
      const contextFootnote = footnoteParts.length > 0 ? footnoteParts.join(' · ') : undefined

      if (reviewContext) {
        preface = reviewContext
      }
      if (quotes.length > 0) {
        const quoteBlocks = quotes.map((q, i) => {
          const label = q.sourceLabel ?? quoteBasename ?? '编辑器'
          const range = q.range ? `#${q.range.startLine}-${q.range.endLine}` : ''
          const text =
            q.text.length > MAX_QUOTE_CHARS
              ? `${q.text.slice(0, MAX_QUOTE_CHARS)}\n… [quote truncated]`
              : q.text
          if (q.text.length > MAX_QUOTE_CHARS) {
            prefaceWarnings.push(`引用选区 ${i + 1} 已截断至 ${MAX_QUOTE_CHARS.toLocaleString()} 字符`)
          }
          return `【引用选区 ${i + 1}：@${label}${range}】\n\`\`\`\n${text}\n\`\`\``
        })
        preface += quoteBlocks.join('\n\n')
        useChatStore.getState().clearQuotes()
      }
      for (const p of attachmentPaths) {
        const info = await fetchFileInfo(p)
        const sizeBytes = info?.size ?? 0
        if (sizeBytes > LARGE_FILE_NO_INJECT_BYTES) {
          const meta = formatLargeFileMetadata({
            path: p,
            sizeBytes,
            lines: info?.lines,
            encoding: info?.encoding,
          })
          const block = `【@${p}】\n${meta}`
          preface += preface ? `\n\n${block}` : block
          prefaceWarnings.push(`附件未注入全文：${p.split(/[/\\]/).pop() ?? p}`)
          continue
        }
        try {
          const res = (await window.electronAPI.file.read(p)) as {
            success?: boolean
            data?: { content?: string }
          }
          const c =
            res?.success && res.data?.content !== undefined ? res.data.content : ''
          const clipped =
            c.length > MAX_PREFACE_SINGLE_CHARS
              ? `${c.slice(0, MAX_PREFACE_SINGLE_CHARS)}\n… [attachment truncated]`
              : c
          if (c.length > MAX_PREFACE_SINGLE_CHARS) {
            prefaceWarnings.push(`附件已截断：${p.split(/[/\\]/).pop() ?? p}`)
          }
          const block = `【@${p}】\n\`\`\`\n${clipped}\n\`\`\``
          preface += preface ? `\n\n${block}` : block
        } catch {
          const err = `【@${p}】(读取失败)`
          preface += preface ? `\n\n${err}` : err
        }
      }

      const { text: clampedPreface, warnings: prefaceClampWarnings } = clampPreface(
        preface.trim() || undefined,
      )
      prefaceWarnings.push(...prefaceClampWarnings)

      const preflightSystemChars =
        2000 +
        slashSkillMetas.reduce((sum, s) => sum + (s.body?.length ?? 0), 0) +
        pinnedFacts.reduce((sum, f) => sum + f.length, 0) +
        (workingSummary?.length ?? 0) +
        (previewPath ? 300 : 0)

      const estimateBeforeSend = estimateInputChars({
        system: 'x'.repeat(Math.max(1, preflightSystemChars)),
        preface: clampedPreface || undefined,
        history: base.history,
        userMessage: llmBody,
      })
      const usagePct = Math.round((estimateBeforeSend.total / MAX_REQUEST_INPUT_CHARS) * 100)

      if (usagePct >= AUTO_COMPRESS_HARD_PCT) {
        await runAutoCompression(`占用 ${usagePct}%`)
        base = await buildAgentContextAsync()
      } else if (usagePct >= AUTO_COMPRESS_SOFT_PCT) {
        prefaceWarnings.push(`上下文占用 ${usagePct}%，接近上限`)
      }

      const estimateAfterCompression = estimateInputChars({
        system: 'x'.repeat(Math.max(1, preflightSystemChars)),
        preface: clampedPreface || undefined,
        history: base.history,
        userMessage: llmBody,
      })
      const finalPct = Math.round((estimateAfterCompression.total / MAX_REQUEST_INPUT_CHARS) * 100)
      if (finalPct >= AUTO_COMPRESS_BLOCK_PCT) {
        setContextToast({
          message: `上下文占用 ${finalPct}% 仍过高，已阻止发送，请继续压缩或缩短输入`,
          variant: 'warn',
        })
        showContextWarnings(prefaceWarnings, setContextToast)
        return
      }

      showContextWarnings(prefaceWarnings, setContextToast)

      const session = useSessionContextStore.getState()
      const context = {
        ...base,
        preface: clampedPreface || undefined,
        contextSummary: session.workingSummary ?? undefined,
        pinnedFacts: session.pinnedFacts.length > 0 ? session.pinnedFacts : undefined,
        explicitSkillNames:
          explicitSkillNames.length > 0 ? explicitSkillNames : undefined,
        workspaceRoot,
        writableRootsExtra: [...writableRootsExtra],
      }

      const shouldStickBottomAfterSend = isAtBottomRef.current

      if (workspaceRoot) {
        await useSessionContextStore.getState().ensureActiveSession(workspaceRoot)
      }

      // Add user message to store（气泡与发给模型的正文均为去掉 /技能名 标记后的文案）
      const userMessage = sendMessage(llmBody, contextFootnote ? { contextFootnote } : undefined)
      if (workspaceRoot) void appendMessageEvent(workspaceRoot, userMessage)

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
      flushBufferedTokens,
      setAgentStatus,
      finalizePendingToolCalls,
      autoCompressHistory,
      compressFromMessages,
      isAutoCompressing,
      persistWorkspaceSession,
      pinnedFacts,
      previewPath,
      slashSkillMetas,
      workingSummary,
    ],
  )

  const handlePinMessage = useCallback(
    (content: string) => {
      const ok = pinFromMessageContent(content)
      if (!ok) {
        setContextToast({ message: '无法钉住（可能已存在或已达上限）', variant: 'warn' })
        return
      }
      const root = useFileStore.getState().workspaceRoot
      if (root) {
        void persistWorkspaceSession(root)
      }
      setContextToast({ message: '已钉住结论，后续对话将注入 system', variant: 'success' })
    },
    [pinFromMessageContent, persistWorkspaceSession],
  )

  const handleCompact = useCallback(async (focus?: string) => {
    if (isAutoCompressing) return
    setIsAutoCompressing(true)
    const root = useFileStore.getState().workspaceRoot
    if (root && !useSessionContextStore.getState().activeSessionId) await persistWorkspaceSession(root)
    const ok = root
      ? await compactAndPersist(root, useChatStore.getState().messages, focus)
      : false
    setIsAutoCompressing(false)
    setContextToast({
      message: ok ? `已压缩当前会话${focus ? `：${focus}` : ''}` : '压缩结果未能持久化，已保留当前热历史',
      variant: ok ? 'success' : 'warn',
    })
  }, [compactAndPersist, isAutoCompressing, persistWorkspaceSession])

  const contextBarHistory = useMemo(
    () =>
      getHistoryForApi(messages).map((m) => ({
        role: (m.role === 'user' ? 'user' : 'assistant') as 'user' | 'assistant',
        content: m.content,
        reasoningContent: m.reasoningContent,
      })),
    [messages, getHistoryForApi, workingSummary],
  )

  /** 基于当前 UI 状态估算 system prompt 字符数，供 ChatContextBar 展示 */
  const estimatedSystemChars = useMemo(() => {
    const base = 2000 // 固定规则 + datetime + writable roots 等
    const skills = slashSkillMetas.reduce((sum, s) => sum + (s.body?.length ?? 0), 0)
    const pinned = pinnedFacts.reduce((sum, f) => sum + f.length, 0)
    const summary = workingSummary?.length ?? 0
    const openFilesSection = previewPath ? 300 : 0
    return base + skills + pinned + summary + openFilesSection
  }, [slashSkillMetas, workingSummary, pinnedFacts, previewPath])

  /* ── Cancel ── */

  const handleCancel = useCallback(() => {
    window.electronAPI.agent.cancel()
    flushBufferedTokens()
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
  }, [flushBufferedTokens, setAgentStatus, finalizePendingToolCalls])

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
      if (flushTimerRef.current !== null) {
        window.clearTimeout(flushTimerRef.current)
        flushTimerRef.current = null
      }
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
      if (tc.name === 'read_file' || tc.name === 'get_file_info') return false
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
                      if (tc.name === 'read_file' || tc.name === 'get_file_info') return false
                      if (tc.name === 'fetch_webpage') return false
                      if (tc.name === 'search_content' && tc.output !== undefined) return false
                      if (tc.name === 'write_file' && agentStatus !== 'idle') return false
                      if (tc.name === 'write_file' && processedWriteCallIds.has(tc.id)) return false
                      const { reportRequested, problemSummaryRequested } = reportIntentForAiMessage(
                        messages,
                        item.message.id,
                      )
                      if (tc.name === 'write_file' && (reportRequested || problemSummaryRequested)) {
                        return false
                      }
                      return true
                    }),
                  )
                if (isEmptyAiMessage) {
                  if (hasVisibleToolCalls) {
                    return (
                      <div className="chat-list-item" style={gapStyle}>
                        <div className="msg-row msg-row--ai">
                          <div className="msg-ai-tool-anchor">AI 工具执行中</div>
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
                      isPinned={
                        item.message.role === 'ai'
                          ? isFactPinned(item.message.content)
                          : undefined
                      }
                      onPin={
                        item.message.role === 'ai' && item.message.content.trim()
                          ? () => handlePinMessage(item.message.content)
                          : undefined
                      }
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
      {reportInfo.show && (
        <ReportExport
          content={reportInfo.content}
          defaultName={reportInfo.defaultName}
          buttonLabel={reportInfo.buttonLabel}
        />
      )}

      {/* Input area */}
      <PinnedFactsBar onPersistHint={(m) => setContextToast({ message: m, variant: 'success' })} />
      <ChatContextBar
        history={contextBarHistory}
        prefaceChars={
          quotesForBar.reduce((sum, q) => sum + q.text.length, 0) + draftStats.attachmentChars
        }
        userMessageChars={draftStats.textChars}
        systemChars={estimatedSystemChars}
        hasSummary={Boolean(workingSummary?.trim())}
        isRunning={isRunning}
        isAutoCompressing={isAutoCompressing}
      />
      <ChatInput
        onSend={handleSend}
        onCancel={handleCancel}
        isRunning={isRunning}
        disabled={isAutoCompressing}
        onDraftStatsChange={setDraftStats}
        mentionFiles={mentionFiles}
        quoteSourceLabel={previewPath ? previewPath.split(/[/\\]/).pop() : undefined}
        slashSkills={slashSkillMetas}
        onCompact={handleCompact}
      />
      <FluxToast toast={contextToast} onDismiss={() => setContextToast(null)} />
    </aside>
  )
}
