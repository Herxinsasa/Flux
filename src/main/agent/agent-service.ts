import fs from 'fs'
import path from 'path'
import { createClient, getActiveClient } from './provider-router'
import type {
  ProviderClient,
  StreamEvent,
  ChatMessage,
  ToolDef,
} from './provider-router'
import log from '../logger'
import store from '../store'
import { isPathUnderWritableRoots } from './writable-roots'
import {
  readFileLineRange,
  getFileInfo,
} from '../services/file-service'
import {
  clampToolResult,
  READ_FILE_DEFAULT_LIMIT,
  READ_FILE_MAX_LINES,
  SEARCH_CONTENT_MAX_LINES,
} from './tool-result-clamp'
import { MAX_TOOL_CHAT_CHARS } from '../../shared/context-budget'

const WEB_FETCH_DEFAULT_TIMEOUT_MS = 12_000
const WEB_FETCH_MAX_OUTPUT_CHARS = MAX_TOOL_CHAT_CHARS

// ----------------------------------------------------------------- Tool definitions

export const BUILTIN_TOOLS: ToolDef[] = [
  {
    name: 'read_file',
    description:
      "Read the contents of a file at the given path. Use this to examine a file's content when the user asks about it or when you need to understand code/log data.",
    input_schema: {
      type: 'object',
      properties: {
        filePath: { type: 'string', description: 'Absolute path to the file to read' },
        offset: { type: 'number', description: 'Line number to start reading from (optional)' },
        limit: { type: 'number', description: 'Max number of lines to read (optional)' },
      },
      required: ['filePath'],
    },
  },
  {
    name: 'write_file',
    description:
      'Propose file edits at a given path. Prefer patch edits (edits array) over full-file replacement. This tool requires explicit user confirmation before writing.',
    input_schema: {
      type: 'object',
      properties: {
        filePath: { type: 'string', description: 'Absolute path to the file to write' },
        content: { type: 'string', description: 'Full-file content (legacy fallback; use only when patch edits are not possible)' },
        edits: {
          type: 'array',
          description: 'Patch edits using 1-based inclusive line ranges',
          items: {
            type: 'object',
            properties: {
              startLine: { type: 'number', description: '1-based start line (inclusive)' },
              endLine: { type: 'number', description: '1-based end line (inclusive)' },
              newText: { type: 'string', description: 'Replacement text for the range' },
            },
            required: ['startLine', 'endLine', 'newText'],
          },
        },
        transactionId: { type: 'string', description: 'Optional transaction id to group multiple file edits' },
      },
      required: ['filePath'],
    },
  },
  {
    name: 'search_content',
    description:
      'Search for a pattern in files or directory. Use ripgrep-style regex search to find matching lines. Useful for finding code references, log patterns, or text occurrences.',
    input_schema: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'Regular expression pattern to search for' },
        directory: { type: 'string', description: 'Directory or file path to search in' },
        fileTypes: { type: 'string', description: 'Optional file extension filter (e.g. ".ts,.js")' },
        caseSensitive: { type: 'boolean', description: 'Whether the search is case-sensitive (default: false)' },
        contextLines: { type: 'number', description: 'Number of context lines around each match (default: 0)' },
      },
      required: ['pattern', 'directory'],
    },
  },
  {
    name: 'get_file_info',
    description:
      "Get metadata about a file: size, line count, encoding, extension. Use to understand a file's structure before reading it.",
    input_schema: {
      type: 'object',
      properties: {
        filePath: { type: 'string', description: 'Absolute path to the file' },
      },
      required: ['filePath'],
    },
  },
  {
    name: 'fetch_webpage',
    description:
      'Fetch content from an http/https webpage for online research. Supports optional query extraction and output truncation.',
    input_schema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'Absolute webpage URL, must start with http:// or https://' },
        query: { type: 'string', description: 'Optional query text to focus extracted lines' },
        timeoutMs: { type: 'number', description: 'Optional timeout in milliseconds (default 12000)' },
        maxChars: { type: 'number', description: 'Optional max returned characters (default 16000)' },
      },
      required: ['url'],
    },
  },
]

// ----------------------------------------------------------------- Tool execution

interface ToolCallInput {
  filePath?: string
  offset?: number
  limit?: number
  content?: string
  edits?: Array<{ startLine?: number; endLine?: number; newText?: string }>
  transactionId?: string
  pattern?: string
  directory?: string
  fileTypes?: string
  caseSensitive?: boolean
  contextLines?: number
  url?: string
  query?: string
  timeoutMs?: number
  maxChars?: number
}

function stripHtmlToText(html: string): string {
  return html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, ' ')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim()
}

function extractTitle(html: string): string {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
  return m?.[1]?.replace(/\s+/g, ' ').trim() ?? ''
}

function extractRelevantContent(text: string, query?: string, maxChars = WEB_FETCH_MAX_OUTPUT_CHARS): string {
  if (!query || !query.trim()) {
    return text.slice(0, maxChars)
  }

  const terms = query
    .toLowerCase()
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean)

  if (terms.length === 0) {
    return text.slice(0, maxChars)
  }

  const sentenceLike = text
    .split(/(?<=[。！？.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean)

  const picked: string[] = []
  for (const s of sentenceLike) {
    const lower = s.toLowerCase()
    if (terms.some((t) => lower.includes(t))) {
      picked.push(s)
    }
    if (picked.join('\n').length >= maxChars) break
  }

  const merged = picked.length > 0 ? picked.join('\n') : text
  return merged.slice(0, maxChars)
}

export interface ToolProgressEvent {
  tool: string
  stage: 'start' | 'progress' | 'done'
  message: string
  elapsedMs?: number
  meta?: Record<string, unknown>
}

function executeTool(
  name: string,
  input: unknown,
  writableRoots: string[],
  readableRoots: string[],
  onProgress?: (evt: ToolProgressEvent) => void,
  signal?: AbortSignal,
): Promise<{ content: string; isError?: boolean }> {
  const inp = input as ToolCallInput
  const startedAt = Date.now()

  const emitProgress = (
    stage: ToolProgressEvent['stage'],
    message: string,
    meta?: Record<string, unknown>,
  ) => {
    onProgress?.({
      tool: name,
      stage,
      message,
      elapsedMs: Date.now() - startedAt,
      ...(meta ? { meta } : {}),
    })
  }

  return (async () => {
    try {
      switch (name) {
      case 'read_file': {
        emitProgress('start', '开始读取文件')
        const fp = inp.filePath
        if (!fp) return { content: 'Error: filePath is required', isError: true }
        const resolved = path.resolve(fp)
        if (!isPathUnderWritableRoots(resolved, readableRoots)) {
          return { content: 'Error: reading outside the active workspace, open tabs, or attached paths is not allowed.', isError: true }
        }
        if (!fs.existsSync(resolved)) return { content: `Error: file not found: ${resolved}`, isError: true }

        const lineLimit = inp.limit != null
          ? Math.min(Math.max(1, Math.floor(inp.limit)), READ_FILE_MAX_LINES)
          : READ_FILE_DEFAULT_LIMIT
        const offset = Math.max(0, Math.floor(inp.offset ?? 0))

        const range = readFileLineRange(resolved, offset, lineLimit)
        const meta = `[read ${path.basename(resolved)} L${range.startLine}-${range.endLine}, total ${range.totalLines} lines${range.truncated ? ', truncated' : ''}]`
        const snippet = range.content ? `${range.content}\n\n${meta}` : meta

        emitProgress('done', '读取文件完成', {
          filePath: resolved,
          totalLines: range.totalLines,
          returnedLines: range.endLine - range.startLine + 1,
          truncated: range.truncated,
        })
        return { content: snippet }
      }

      case 'write_file': {
        const fp = inp.filePath
        if (!fp) return { content: 'Error: filePath is required', isError: true }

        const hasContent = typeof inp.content === 'string'
        const hasEdits = Array.isArray(inp.edits) && inp.edits.length > 0
        if (!hasContent && !hasEdits) {
          return {
            content: 'Error: write_file requires either content (legacy) or edits (preferred)',
            isError: true,
          }
        }

        const resolved = path.resolve(fp)
        if (!isPathUnderWritableRoots(resolved, writableRoots)) {
          return {
            content:
              'Error: writing outside allowed locations is not allowed (allowed: opened workspace, open tabs / @ paths, user data & imported skills).',
            isError: true,
          }
        }

        // 仅生成待确认写入内容；实际落盘由 renderer 侧“确认写入”触发 editor:apply-change
        const previewPayload: Record<string, unknown> = {
          mode: hasEdits ? 'edits' : 'full',
          filePath: resolved,
          transactionId: inp.transactionId,
        }
        if (hasEdits) previewPayload.edits = inp.edits
        if (hasContent) previewPayload.content = inp.content
        return { content: JSON.stringify(previewPayload) }
      }

      case 'search_content': {
        emitProgress('start', '开始搜索内容')
        const pattern = inp.pattern
        const dirStr = inp.directory
        if (!pattern || !dirStr) {
          return { content: 'Error: pattern and directory are required', isError: true }
        }
        const resolvedSearchRoot = path.resolve(dirStr)
        if (!isPathUnderWritableRoots(resolvedSearchRoot, readableRoots)) {
          return { content: 'Error: searching outside the active workspace, open tabs, or attached paths is not allowed.', isError: true }
        }

        // Build a regex from the pattern (no 'g' flag to avoid stateful lastIndex issues)
        let regex: RegExp
        try {
          regex = new RegExp(pattern, inp.caseSensitive ? '' : 'i')
        } catch (err) {
          return { content: `Error: invalid regex pattern: ${err instanceof Error ? err.message : String(err)}`, isError: true }
        }

        const ctx = inp.contextLines ?? 0
        const exts = inp.fileTypes
          ? inp.fileTypes.split(',').map((e) => e.trim().replace(/^\./, '').toLowerCase())
          : null

        // Known binary / non-text extensions to skip
        const BINARY_EXTS = /\.(exe|dll|pdb|obj|bin|o|a|so|dylib|png|jpe?g|gif|ico|bmp|webp|woff2?|ttf|eot|zip|gz|tar|7z|bz2|xz|pdf|mp[34]|avi|mov|mkv|class|jar)$/i

        const MAX_RESULT_LINES = SEARCH_CONTENT_MAX_LINES
        const MAX_SCANNED_FILES = 5000
        const MAX_FILE_BYTES = 4 * 1024 * 1024
        const results: string[] = []
        let scannedFiles = 0

        const reportScanProgress = () => {
          if (scannedFiles > 0 && scannedFiles % 200 === 0) {
            emitProgress('progress', '搜索进行中', { scannedFiles, matchedLines: results.length })
          }
        }

        async function searchFile(filePath: string): Promise<void> {
          if (results.length >= MAX_RESULT_LINES) return
          if (scannedFiles >= MAX_SCANNED_FILES) return
          if (signal?.aborted) return
          scannedFiles++
          reportScanProgress()
          let content: string
          try {
            const stat = await fs.promises.stat(filePath)
            if (stat.size > MAX_FILE_BYTES) return
            content = await fs.promises.readFile(filePath, 'utf-8')
          } catch {
            return // skip unreadable files
          }

          const lines = content.split('\n')
          const matchedLines = new Set<number>()

          for (let i = 0; i < lines.length; i++) {
            if (regex.test(lines[i])) {
              matchedLines.add(i)
            }
          }

          for (const idx of Array.from(matchedLines)) {
            const start = Math.max(0, idx - ctx)
            const end = Math.min(lines.length, idx + ctx + 1)
            for (let j = start; j < end; j++) {
              results.push(`${filePath}:${j + 1}:${lines[j]}`)
            }
            if (results.length >= MAX_RESULT_LINES) break
          }
        }

        async function walkDir(dir: string): Promise<void> {
          const pendingDirs = [dir]
          while (pendingDirs.length > 0 && results.length < MAX_RESULT_LINES && scannedFiles < MAX_SCANNED_FILES) {
            if (signal?.aborted) return
            const currentDir = pendingDirs.pop()!
            let entries: fs.Dirent[]
            try {
              entries = await fs.promises.readdir(currentDir, { withFileTypes: true })
            } catch {
              continue
            }

            for (const entry of entries) {
              if (signal?.aborted || results.length >= MAX_RESULT_LINES || scannedFiles >= MAX_SCANNED_FILES) return
              const fullPath = path.join(currentDir, entry.name)
              if (entry.isDirectory()) {
                if (entry.name !== 'node_modules' && entry.name !== '.git') pendingDirs.push(fullPath)
              } else if (entry.isFile()) {
                if (BINARY_EXTS.test(entry.name)) continue
                if (exts) {
                  const ext = path.extname(entry.name).replace(/^\./, '').toLowerCase()
                  if (!exts.includes(ext)) continue
                }
                await searchFile(fullPath)
              }
            }
          }
        }

        // Determine whether dirStr points to a single file or a directory
        try {
          const stat = await fs.promises.stat(resolvedSearchRoot)
          if (stat.isFile()) {
            if (!BINARY_EXTS.test(path.basename(resolvedSearchRoot))) {
              await searchFile(resolvedSearchRoot)
            }
          } else {
            await walkDir(resolvedSearchRoot)
          }
        } catch {
          return { content: `Error: search path not found or unreadable: ${resolvedSearchRoot}`, isError: true }
        }

        const output = results.slice(0, MAX_RESULT_LINES).join('\n')
        const hitCount = results.length
        const suffix =
          hitCount >= MAX_RESULT_LINES
            ? `\n\n[search "${pattern}" → ${hitCount}+ hits, showing ${MAX_RESULT_LINES}]`
            : hitCount > 0
              ? `\n\n[search "${pattern}" → ${hitCount} hit(s)]`
              : ''
        emitProgress('done', '搜索完成', {
          scannedFiles,
          matchedLines: hitCount,
          reachedLimit: hitCount >= MAX_RESULT_LINES,
          scanLimitReached: scannedFiles >= MAX_SCANNED_FILES,
        })
        return { content: (output || '(no matches)') + suffix }
      }

      case 'get_file_info': {
        const fp = inp.filePath
        if (!fp) return { content: 'Error: filePath is required', isError: true }
        const resolved = path.resolve(fp)
        if (!isPathUnderWritableRoots(resolved, readableRoots)) {
          return { content: 'Error: reading outside the active workspace, open tabs, or attached paths is not allowed.', isError: true }
        }
        const info = getFileInfo(resolved)
        return {
          content: JSON.stringify(
            {
              path: info.path,
              name: info.name,
              size: info.size,
              lines: info.lines,
              encoding: info.encoding,
              extension: info.extension,
            },
            null,
            2,
          ),
        }
      }

      case 'fetch_webpage': {
        emitProgress('start', '开始抓取网页内容')
        const rawUrl = inp.url?.trim()
        if (!rawUrl) return { content: 'Error: url is required', isError: true }

        let parsed: URL
        try {
          parsed = new URL(rawUrl)
        } catch {
          return { content: `Error: invalid url: ${rawUrl}`, isError: true }
        }

        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
          return { content: 'Error: only http/https urls are supported', isError: true }
        }

        const timeoutMs = Number.isFinite(inp.timeoutMs)
          ? Math.max(1000, Math.floor(inp.timeoutMs as number))
          : WEB_FETCH_DEFAULT_TIMEOUT_MS
        const maxChars = Number.isFinite(inp.maxChars)
          ? Math.max(500, Math.floor(inp.maxChars as number))
          : WEB_FETCH_MAX_OUTPUT_CHARS

        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), timeoutMs)

        try {
          const resp = await fetch(parsed.toString(), {
            method: 'GET',
            redirect: 'follow',
            signal: controller.signal,
            headers: {
              'user-agent': 'FluxApp/1.0 (desktop; research-fetch)',
              accept: 'text/html,application/json,text/plain;q=0.9,*/*;q=0.8',
            },
          })

          const body = await resp.text()
          const contentType = resp.headers.get('content-type') ?? ''
          const isHtml = /text\/html|application\/xhtml\+xml/i.test(contentType)
          const title = isHtml ? extractTitle(body) : ''
          const plainText = isHtml ? stripHtmlToText(body) : body.replace(/\s+/g, ' ').trim()
          const focused = extractRelevantContent(plainText, inp.query, maxChars)

          emitProgress('done', '网页抓取完成', {
            url: parsed.toString(),
            status: resp.status,
            contentType,
            returnedChars: focused.length,
          })

          return {
            content: JSON.stringify(
              {
                url: parsed.toString(),
                finalUrl: resp.url,
                status: resp.status,
                ok: resp.ok,
                contentType,
                title,
                excerpt: focused,
                truncated: plainText.length > focused.length,
              },
              null,
              2,
            ),
          }
        } catch (err) {
          const reason = err instanceof Error ? err.message : String(err)
          return { content: `Error: fetch failed: ${reason}`, isError: true }
        } finally {
          clearTimeout(timer)
        }
      }

      default:
        return { content: `Unknown tool: ${name}`, isError: true }
    }
    } catch (err) {
      log.error(`Tool execution error: ${name}`, err)
      return {
        content: `Tool execution error: ${err instanceof Error ? err.message : String(err)}`,
        isError: true,
      }
    }
  })()
}

// ----------------------------------------------------------------- Agent loop

function releaseToolMessagePayloads(messages: ChatMessage[]): void {
  for (const m of messages) {
    if (m.role === 'tool' && m.content.length > 256) {
      m.content = `[tool output released after agent run, was ${m.content.length} chars]`
    }
  }
}

export interface AgentRunParams {
  providerId?: string
  messages: ChatMessage[]
  system?: string
  tools?: ToolDef[]
  maxTokens?: number
  maxToolRoundtrips?: number
  /** write_file 允许的绝对路径前缀（工作区、已打开文件目录、userData 等） */
  writableRoots?: string[]
  /** read_file / search_content / get_file_info 允许的绝对路径前缀 */
  readableRoots?: string[]
  /** 工具执行进度回调（用于 UI 反馈） */
  onToolProgress?: (evt: ToolProgressEvent) => void
}

/**
 * Run the agent loop:
 *   1. Send messages to the provider
 *   2. If tool_use → execute tool → yield tool_result → feed back
 *   3. Loop until text response or stop
 *
 * @param signal  Optional AbortSignal for cancellation from AgentProcessManager.
 *                When aborted, the generator yields an error event and returns.
 */
export async function* runAgent(
  params: AgentRunParams,
  signal?: AbortSignal,
): AsyncGenerator<StreamEvent> {
  const tools = params.tools ?? BUILTIN_TOOLS
  const maxRounds = params.maxToolRoundtrips ?? 10

  let client: ProviderClient | null = null
  let model: string

  try {
    if (params.providerId) {
      client = createClient(params.providerId)
    } else {
      client = getActiveClient()
    }
  } catch (err) {
    yield {
      type: 'error',
      message: `Provider error: ${err instanceof Error ? err.message : String(err)}`,
    }
    return
  }

  if (!client) {
    yield { type: 'error', message: 'No active provider configured. Please set up an AI provider in Settings.' }
    return
  }

  // Read model from store for the active provider
  const providerId = params.providerId ?? store.get('activeProvider') ?? ''
  const providers = store.get('providers')
  const providerCfg = providers.find((p) => p.id === providerId)
  model = providerCfg?.model ?? 'claude-sonnet-4-20250514'

  // Track for cancellation
  activeClient = client

  const chatMessages: ChatMessage[] = [...params.messages]
  const writableRoots = params.writableRoots ?? []
  const readableRoots = params.readableRoots ?? []

  try {
    for (let round = 0; round <= maxRounds; round++) {
      if (signal?.aborted) {
        yield { type: 'error', message: 'Agent was cancelled' }
        return
      }

      const stream = client.chat({
        model,
        messages: chatMessages,
        system: params.system,
        tools,
        maxTokens: params.maxTokens,
      })

      let hasToolUse = false
      let roundReasoning = ''
      const toolCalls: Array<{
        id: string
        name: string
        input: unknown
      }> = []

      for await (const event of stream) {
        if (event.type === 'text_delta') {
          yield event
        } else if (event.type === 'reasoning_delta') {
          roundReasoning += event.text
          yield event
        } else if (event.type === 'tool_use') {
          hasToolUse = true
          toolCalls.push({ id: event.id, name: event.name, input: event.input })
          yield event
        } else if (event.type === 'message_stop') {
          if (!hasToolUse) {
            yield event
            return
          }
        } else if (event.type === 'error') {
          yield event
          return
        }
      }

      if (hasToolUse && toolCalls.length > 0) {
        if (signal?.aborted) {
          yield { type: 'error', message: 'Agent was cancelled' }
          return
        }

        let firstToolMsg = true
        for (const tc of toolCalls) {
          chatMessages.push({
            role: 'assistant',
            content: '',
            reasoningContent: firstToolMsg && roundReasoning ? roundReasoning : undefined,
            toolCallId: tc.id,
            toolName: tc.name,
            input: tc.input,
          })
          firstToolMsg = false
        }
        roundReasoning = ''

        for (const tc of toolCalls) {
          const result = await executeTool(
            tc.name,
            tc.input,
            writableRoots,
            readableRoots,
            params.onToolProgress,
            signal,
          )
          const clamped = clampToolResult(tc.name, result.content, result.isError)

          yield {
            type: 'tool_result',
            id: tc.id,
            content: result.content,
            isError: result.isError,
          }
          chatMessages.push({
            role: 'tool',
            content: clamped,
            toolCallId: tc.id,
          })
        }
        continue
      }

      yield { type: 'message_stop' }
      return
    }

    yield { type: 'error', message: 'Maximum tool round-trips reached. Stopping agent.' }
  } finally {
    releaseToolMessagePayloads(chatMessages)
    activeClient = null
  }
}

// ----------------------------------------------------------------- Singleton state for cancellation

let activeClient: ProviderClient | null = null

export function setActiveAgentClient(client: ProviderClient | null): void {
  activeClient = client
}

export function cancelActiveAgent(): void {
  if (activeClient) {
    activeClient.abort()
    activeClient = null
  }
}
