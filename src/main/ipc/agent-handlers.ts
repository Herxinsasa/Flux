import { ipcMain, BrowserWindow } from 'electron'
import { IPC_CHANNELS } from '../../shared/ipc-channels'
import { runAgent, cancelActiveAgent } from '../agent/agent-service'
import { AgentProcessManager } from '../agent/agent-sandbox'
import { buildSkillSystemPrompt } from '../skill/matcher'
import { SkillManager } from '../skill/skill-manager'
import type { ChatMessage } from '../agent/provider-router'
import { collectReadableRoots, collectWritableRoots } from '../agent/writable-roots'
import { assembleAgentContext } from '../agent/context-assembler'
import { MAX_TOOL_IPC_CHARS } from '../../shared/context-budget'
import log from '../logger'

const IPC_PROGRESS_TICK_MS = 5000
const IPC_PROGRESS_WARN_MS = 30000

interface SendContext {
  /** Paths of currently open files */
  openFiles?: Array<{
    path: string
    content?: string
    selectedText?: string
  }>
  /** 前序对话（assistant 可含 reasoningContent 供思考模式回传） */
  history?: ChatMessage[]
  /** 拼在用户本轮问题前的补充（引用选区、@ 文件等） */
  preface?: string
  /** Active provider ID (override) */
  providerId?: string
  /** 用户通过 /技能名 显式点名的 Skill（优先注入，含已禁用仍注入） */
  explicitSkillNames?: string[]
  /** 当前打开的文件夹根路径（用于 write_file 安全范围） */
  workspaceRoot?: string | null
  /** 额外允许写入的目录绝对路径（已打开标签、@ 附件所在目录等） */
  writableRootsExtra?: string[]
  /** P1: 冷层对话规则摘要 */
  contextSummary?: string
  /** P3 prep: pinned 结论 */
  pinnedFacts?: string[]
}

function buildSystemPrompt(context?: SendContext): string {
  const parts: string[] = []

  parts.push('You are Flux AI, an intelligent assistant integrated into a desktop text editor.')
  parts.push('You help users write, analyze, and edit text/code/log files.')
  parts.push('')
  parts.push('Guidelines:')
  parts.push('- Be concise and direct. Prefer short, actionable responses.')
  parts.push('- When analyzing files, reference specific line numbers when possible.')
  parts.push('- When suggesting edits, use exact text matches from the file so the user can apply changes.')
  parts.push(
    '- The section below is the user\'s active preview file (unless they used @ or pasted other references). Prioritize it when answering; call read_file for paths not listed or when you need a fresher read.',
  )
  parts.push('- Use search_content to find patterns across files.')
  parts.push('- Use fetch_webpage to retrieve online information when the user asks for internet/web references.')
  parts.push('- Use write_file only when the user explicitly asks you to create or modify a file.')
  parts.push('- For write_file, prefer patch edits via edits[] (startLine/endLine/newText) over full content replacement.')
  parts.push('- If multiple files are modified in one turn, include a shared transactionId to group them.')
  parts.push('')
  parts.push('Report delivery (Flux Plan A — user exports via the in-app button):')
  parts.push('- When the user asks for an analysis report, formal report, or Markdown deliverable: write the FULL structured report in your chat reply (executive summary first, then findings, tables, and recommendations).')
  parts.push('- Do NOT use write_file to create or save .md report files unless the user explicitly names a file path AND asks you to write/save to disk.')
  parts.push('- Never claim a report was exported or saved to disk; Flux requires the user to click「导出报告」. write_file only produces a preview until the user confirms.')
  parts.push('- After delivering the report in chat, briefly remind the user they can click「导出报告」below to save a Markdown file.')
  parts.push('- For large log files: use search_content to locate patterns, then read_file(offset, limit) for targeted sections — do not assume the full file is in context.')

  try {
    /** list() 内部会 ensureInit；SkillManager.init() 在 registerAllHandlers 已调用且幂等 */
    const skillNames = SkillManager.getInstance()
      .list()
      .filter((m) => m.enabled)
      .map((m) => m.name)
    if (skillNames.length > 0) {
      parts.push('')
      parts.push(
        `已安装的 Skill 技能包（可与用户问题关键词匹配后自动注入；用户点名时请优先遵循）：${skillNames.join(', ')}`,
      )
    }
  } catch {
    /* ignore skill catalog errors */
  }

  return parts.join('\n')
}

export function registerAgentHandlers(): void {
  const { AGENT_SEND, AGENT_CANCEL, AGENT_STREAM } = IPC_CHANNELS

  const processManager = new AgentProcessManager()

  ipcMain.handle(AGENT_SEND, async (event, message: string, context?: SendContext) => {
    let progressTimer: NodeJS.Timeout | null = null
    const requestStartedAt = Date.now()

    const senderWindow = BrowserWindow.fromWebContents(event.sender)
    const pushStreamEvent = (payload: unknown) => {
      senderWindow?.webContents.send(AGENT_STREAM, JSON.stringify(payload))
    }

    try {
      log.info('Agent send:', { message: message.slice(0, 100), hasContext: !!context })

      const writableRoots = collectWritableRoots({
        workspaceRoot: context?.workspaceRoot,
        writableRootsExtra: context?.writableRootsExtra,
        openFiles: context?.openFiles,
      })
      const readableRoots = collectReadableRoots({
        workspaceRoot: context?.workspaceRoot,
        writableRootsExtra: context?.writableRootsExtra,
        openFiles: context?.openFiles,
      })

      const baseSystem = buildSystemPrompt(context)
      const {
        systemPrompt: systemWithSkills,
        invalidMatchedSkills,
        activeSkills,
        unresolvedExplicitSkills,
      } = buildSkillSystemPrompt(message, baseSystem, {
        explicitSkillNames: context?.explicitSkillNames,
        workspaceRoot: context?.workspaceRoot,
      })

      const skillSystemSuffix =
        systemWithSkills.length > baseSystem.length
          ? systemWithSkills.slice(baseSystem.length)
          : undefined

      const assembled = assembleAgentContext({
        baseSystemPrompt: baseSystem,
        skillSystemSuffix,
        contextSummary: context?.contextSummary,
        pinnedFacts: context?.pinnedFacts,
        preface: context?.preface,
        userMessage: message,
        history: (context?.history ?? []) as ChatMessage[],
        openFiles: context?.openFiles,
      })

      const { chatMessages, system: systemPrompt, warnings: contextWarnings } = assembled

      for (const w of contextWarnings) {
        pushStreamEvent({
          type: 'progress',
          stage: 'context_budget',
          message: w,
          elapsedMs: Date.now() - requestStartedAt,
        })
      }

      if (activeSkills.length > 0) {
        pushStreamEvent({
          type: 'progress',
          stage: 'skill_active',
          message: `已注入 Skill：${activeSkills.join('、')}`,
          elapsedMs: Date.now() - requestStartedAt,
          meta: { activeSkills },
        })
      }

      if (unresolvedExplicitSkills.length > 0) {
        pushStreamEvent({
          type: 'progress',
          stage: 'skill_unresolved',
          message: `未找到 Skill：${unresolvedExplicitSkills.join('、')}（请确认名称或导入路径）`,
          elapsedMs: Date.now() - requestStartedAt,
          meta: { unresolvedExplicitSkills },
        })
      }

      if (invalidMatchedSkills.length > 0) {
        pushStreamEvent({
          type: 'progress',
          stage: 'skill_invalid',
          message: `检测到失效 Skill：${invalidMatchedSkills.join('、')}，已跳过注入，请先在 Skill 面板清理或重新导入。`,
          elapsedMs: Date.now() - requestStartedAt,
          meta: { invalidSkills: invalidMatchedSkills },
        })
      }

      pushStreamEvent({
        type: 'progress',
        stage: 'ipc_start',
        message: '请求已发送到主进程，准备启动 Agent',
        elapsedMs: 0,
      })

      progressTimer = setInterval(() => {
        const elapsedMs = Date.now() - requestStartedAt
        pushStreamEvent({
          type: 'progress',
          stage: elapsedMs >= IPC_PROGRESS_WARN_MS ? 'ipc_wait_warn' : 'ipc_wait',
          message:
            elapsedMs >= IPC_PROGRESS_WARN_MS
              ? `请求处理中（已等待 ${Math.floor(elapsedMs / 1000)}s，仍在执行）`
              : `请求处理中（${Math.floor(elapsedMs / 1000)}s）`,
          elapsedMs,
        })
      }, IPC_PROGRESS_TICK_MS)

      // Run through AgentProcessManager for timeout/retry isolation
      await processManager.run(
        (signal) =>
          runAgent(
            {
              messages: chatMessages,
              system: systemPrompt,
              providerId: context?.providerId,
              writableRoots,
              readableRoots,
              onToolProgress: (progress) => {
                pushStreamEvent({
                  type: 'progress',
                  stage: `tool_${progress.stage}`,
                  message: `[${progress.tool}] ${progress.message}`,
                  elapsedMs: progress.elapsedMs,
                  tool: progress.tool,
                  meta: progress.meta,
                })
              },
            },
            signal,
          ),
        (evt) => {
          log.debug('Agent stream event', {
            type: evt.type,
            ...(evt.type === 'text_delta'
              ? { textLen: evt.text.length }
              : evt.type === 'reasoning_delta'
                ? { textLen: evt.text.length }
                : evt.type === 'tool_use'
                  ? { tool: evt.name, id: evt.id }
                  : evt.type === 'tool_result'
                    ? { id: evt.id, isError: evt.isError, contentLen: evt.content.length }
                    : evt.type === 'error'
                      ? { message: evt.message }
                      : {}),
          })

          switch (evt.type) {
            case 'text_delta':
              // Stream text tokens to the renderer
              senderWindow?.webContents.send(AGENT_STREAM, evt.text)
              break

            case 'reasoning_delta':
              senderWindow?.webContents.send(
                AGENT_STREAM,
                JSON.stringify({ type: 'reasoning_delta', text: evt.text }),
              )
              break

            case 'tool_use':
              log.info('Tool use:', { name: evt.name, id: evt.id })
              senderWindow?.webContents.send(
                AGENT_STREAM,
                JSON.stringify({
                  type: 'tool_use',
                  id: evt.id,
                  name: evt.name,
                  input: evt.input,
                }),
              )
              break

            case 'tool_result':
              log.info('Tool result:', { id: evt.id, isError: evt.isError })
              {
                const safeContent =
                  evt.content.length > MAX_TOOL_IPC_CHARS
                    ? `${evt.content.slice(0, MAX_TOOL_IPC_CHARS)}\n...(truncated)`
                    : evt.content
              senderWindow?.webContents.send(
                AGENT_STREAM,
                JSON.stringify({
                  type: 'tool_result',
                  id: evt.id,
                  content: safeContent,
                  isError: evt.isError,
                }),
              )
              }
              break

            case 'message_stop':
              log.info('Agent run complete')
              senderWindow?.webContents.send(AGENT_STREAM, '[DONE]')
              break

            case 'error':
              log.error('Agent error:', evt.message)
              senderWindow?.webContents.send(
                AGENT_STREAM,
                JSON.stringify({ type: 'error', message: evt.message }),
              )
              break
          }
        },
        (status) => {
          log.info(`Agent status: ${status}`)
          senderWindow?.webContents.send(
            AGENT_STREAM,
            JSON.stringify({ type: 'status', status }),
          )
        },
      )

      pushStreamEvent({
        type: 'progress',
        stage: 'ipc_done',
        message: '请求处理完成',
        elapsedMs: Date.now() - requestStartedAt,
      })

      return { success: true }
    } catch (err) {
      const errMessage = err instanceof Error ? err.message : String(err)
      log.error('Agent handler error:', errMessage)

      pushStreamEvent({
        type: 'progress',
        stage: 'ipc_error',
        message: '请求处理失败',
        elapsedMs: Date.now() - requestStartedAt,
      })
      pushStreamEvent({ type: 'error', message: errMessage })

      return { success: false, error: errMessage }
    } finally {
      if (progressTimer) {
        clearInterval(progressTimer)
      }
    }
  })

  ipcMain.handle(AGENT_CANCEL, async () => {
    log.info('Agent cancel requested')

    // Cancel the process manager (aborts the current attempt)
    processManager.cancel()

    // Also abort any active provider client
    cancelActiveAgent()

    return { success: true }
  })
}
