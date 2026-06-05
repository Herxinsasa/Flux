import {
  MAX_TOOL_CHAT_CHARS,
  READ_FILE_DEFAULT_LIMIT,
  READ_FILE_MAX_CHARS,
  READ_FILE_MAX_LINES,
  SEARCH_CONTENT_MAX_LINES,
} from '../../shared/context-budget'

const SEARCH_CLAMP_LINES = 200
const READ_FILE_META_PREFIX = '\n\n['

function genericClamp(content: string, max = MAX_TOOL_CHAT_CHARS): string {
  if (content.length <= max) return content
  return `${content.slice(0, max)}\n...(truncated, ${content.length} chars total)`
}

function extractTrailingMeta(content: string): { body: string; meta: string | null } {
  const idx = content.lastIndexOf(READ_FILE_META_PREFIX)
  if (idx === -1) return { body: content, meta: null }
  const meta = content.slice(idx)
  if (!meta.endsWith(']')) return { body: content, meta: null }
  return { body: content.slice(0, idx), meta }
}

function clampReadFile(content: string): string {
  const { body, meta } = extractTrailingMeta(content)
  const rawBudget = meta ? MAX_TOOL_CHAT_CHARS - meta.length : MAX_TOOL_CHAT_CHARS
  // 防御：meta 极长时保证 body 至少有最小展示空间
  const bodyBudget = Math.max(200, rawBudget)
  if (body.length <= bodyBudget) return content
  const clampedBody = `${body.slice(0, bodyBudget - 30)}\n...(truncated)`
  return meta ? `${clampedBody}${meta}` : genericClamp(content)
}

function clampSearchContent(content: string): string {
  if (content === '(no matches)') return content

  const lines = content.split('\n')
  const truncated = lines.length > SEARCH_CLAMP_LINES
  const shown = truncated ? lines.slice(0, SEARCH_CLAMP_LINES) : lines

  let meta = `[search → ${lines.length} result line(s)`
  if (truncated) meta += `, showing ${SEARCH_CLAMP_LINES}`
  meta += ']'

  let body = shown.join('\n')
  const metaBudget = meta.length + 2
  if (body.length + metaBudget > MAX_TOOL_CHAT_CHARS) {
    body = body.slice(0, MAX_TOOL_CHAT_CHARS - metaBudget - 20) + '\n...(truncated)'
  }
  return truncated || lines.length > SEARCH_CLAMP_LINES ? `${body}\n\n${meta}` : genericClamp(content)
}

function clampWriteFile(content: string): string {
  try {
    const parsed = JSON.parse(content) as Record<string, unknown>
    const summary: Record<string, unknown> = {
      mode: parsed.mode,
      filePath: parsed.filePath,
      transactionId: parsed.transactionId,
    }
    if (parsed.mode === 'edits' && Array.isArray(parsed.edits)) {
      summary.edits = parsed.edits.map((e: { startLine?: number; endLine?: number }) => ({
        startLine: e.startLine,
        endLine: e.endLine,
      }))
      summary.editCount = parsed.edits.length
    } else if (typeof parsed.content === 'string') {
      summary.contentChars = parsed.content.length
    }
    const out = JSON.stringify(summary, null, 2)
    return out.length <= MAX_TOOL_CHAT_CHARS ? out : genericClamp(out)
  } catch {
    return genericClamp(content)
  }
}

function clampFetchWebpage(content: string): string {
  try {
    const parsed = JSON.parse(content) as Record<string, unknown>
    if (typeof parsed.excerpt === 'string' && parsed.excerpt.length > MAX_TOOL_CHAT_CHARS - 512) {
      parsed.excerpt = `${parsed.excerpt.slice(0, MAX_TOOL_CHAT_CHARS - 512)}\n...(truncated)`
      parsed.truncated = true
    }
    const out = JSON.stringify(parsed, null, 2)
    return out.length <= MAX_TOOL_CHAT_CHARS ? out : genericClamp(out)
  } catch {
    return genericClamp(content)
  }
}

/**
 * Clamp tool output before it enters runAgent chatMessages (API context).
 * Renderer IPC uses a separate 4K cap in agent-handlers.
 */
export function clampToolResult(name: string, content: string, isError?: boolean): string {
  if (isError) return genericClamp(content)
  switch (name) {
    case 'read_file':
      return clampReadFile(content)
    case 'search_content':
      return clampSearchContent(content)
    case 'write_file':
      return clampWriteFile(content)
    case 'fetch_webpage':
      return clampFetchWebpage(content)
    default:
      return genericClamp(content)
  }
}

export { READ_FILE_DEFAULT_LIMIT, READ_FILE_MAX_CHARS, READ_FILE_MAX_LINES, SEARCH_CONTENT_MAX_LINES }
