import Anthropic from '@anthropic-ai/sdk'
import type { MessageParam, Tool as AnthropicTool } from '@anthropic-ai/sdk/resources/messages/messages'
import OpenAI from 'openai'
import type { ChatCompletionMessageParam, ChatCompletionTool } from 'openai/resources/chat/completions/completions'
import store from '../store'
import log from '../logger'

// ----------------------------------------------------------------- Types

export type ProviderType = 'anthropic' | 'anthropic_compat' | 'openai_compat'

export interface ChatMessage {
  role: 'user' | 'assistant' | 'tool'
  content: string
  /** DeepSeek 等「思考模式」多轮对话需回传上一轮 assistant 的推理文本 */
  reasoningContent?: string
  toolCallId?: string
  toolName?: string
  input?: unknown
}

export interface ChatParams {
  model: string
  messages: ChatMessage[]
  system?: string
  tools?: ToolDef[]
  maxTokens?: number
  onCancel?: AbortSignal
}

export interface ToolDef {
  name: string
  description: string
  input_schema: {
    type: 'object'
    properties?: Record<string, unknown>
    required?: string[]
    [k: string]: unknown
  }
}

export type StreamEvent =
  | { type: 'text_delta'; text: string }
  | { type: 'reasoning_delta'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; id: string; content: string; isError?: boolean }
  | { type: 'message_start'; messageId: string }
  | { type: 'message_stop' }
  | { type: 'error'; message: string }

export interface ProviderClient {
  type: ProviderType
  chat: (params: ChatParams) => AsyncGenerator<StreamEvent>
  abort: () => void
}

// ----------------------------------------------------------------- Helpers

function toAnthropicMessages(messages: ChatMessage[]): MessageParam[] {
  const result: MessageParam[] = []

  for (const msg of messages) {
    if (msg.role === 'tool') {
      // Tool results MUST be wrapped in a user message per Anthropic API.
      const toolResultBlock = {
        type: 'tool_result' as const,
        tool_use_id: msg.toolCallId ?? '',
        content: msg.content,
      }

      const last = result[result.length - 1]
      if (last && last.role === 'user') {
        // Merge into existing user message
        if (Array.isArray(last.content)) {
          last.content.push(toolResultBlock)
        } else {
          last.content = [
            { type: 'text' as const, text: last.content as string },
            toolResultBlock,
          ]
        }
      } else {
        result.push({ role: 'user', content: [toolResultBlock] })
      }
    } else if (msg.role === 'assistant' && msg.toolCallId) {
      // Tool use MUST be in an assistant message as a tool_use content block.
      const toolUseBlock = {
        type: 'tool_use' as const,
        id: msg.toolCallId,
        name: msg.toolName ?? 'unknown',
        input: (msg.input as Record<string, unknown>) ?? {},
      }

      const last = result[result.length - 1]
      if (last && last.role === 'assistant') {
        // Merge into existing assistant message (multiple tool_use blocks)
        if (Array.isArray(last.content)) {
          last.content.push(toolUseBlock)
        } else {
          last.content = [
            { type: 'text' as const, text: last.content as string },
            toolUseBlock,
          ]
        }
      } else {
        result.push({ role: 'assistant', content: [toolUseBlock] })
      }
    } else {
      // Plain text user/assistant message
      result.push({
        role: msg.role as 'user' | 'assistant',
        content: msg.content,
      })
    }
  }

  return result
}

/** OpenAI/DeepSeek 工具参数：内部存于 input，勿用空的 content */
function serializeToolCallArguments(msg: ChatMessage): string {
  if (msg.content && String(msg.content).trim()) return String(msg.content)
  const inp = msg.input
  if (inp === undefined || inp === null) return '{}'
  if (typeof inp === 'string') return inp
  try {
    return JSON.stringify(inp)
  } catch {
    return '{}'
  }
}

/**
 * 合并连续的 assistant+tool 为单条 `tool_calls`（DeepSeek 等思考模式要求整轮助手消息一致且必须回传 reasoning_content）。
 */
function toOpenAiMessages(messages: ChatMessage[], system?: string): ChatCompletionMessageParam[] {
  const result: ChatCompletionMessageParam[] = []
  if (system) {
    result.push({ role: 'system', content: system })
  }

  let i = 0
  while (i < messages.length) {
    const msg = messages[i]

    if (msg.role === 'user') {
      result.push({ role: 'user', content: msg.content })
      i++
      continue
    }

    if (msg.role === 'tool') {
      result.push({
        role: 'tool',
        tool_call_id: msg.toolCallId ?? '',
        content: msg.content,
      })
      i++
      continue
    }

    if (msg.role === 'assistant') {
      if (msg.toolCallId) {
        const group: ChatMessage[] = []
        while (
          i < messages.length &&
          messages[i].role === 'assistant' &&
          messages[i].toolCallId
        ) {
          group.push(messages[i])
          i++
        }
        const reasoning = group[0]?.reasoningContent
        const tool_calls = group.map((m) => ({
          id: m.toolCallId!,
          type: 'function' as const,
          function: {
            name: m.toolName ?? '',
            arguments: serializeToolCallArguments(m),
          },
        }))
        // DeepSeek 等思考模式：content 用空字符串优于 null，避免与 reasoning_content 组合校验失败
        result.push({
          role: 'assistant',
          content: '',
          ...(reasoning ? { reasoning_content: reasoning } : {}),
          tool_calls,
        } as ChatCompletionMessageParam)
        continue
      }

      result.push({
        role: 'assistant',
        content: msg.content,
        ...(msg.reasoningContent ? { reasoning_content: msg.reasoningContent } : {}),
      } as ChatCompletionMessageParam)
      i++
      continue
    }

    i++
  }

  return result
}

function toAnthropicTools(tools: ToolDef[]): AnthropicTool[] {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.input_schema,
  }))
}

function toOpenAiTools(tools: ToolDef[]): ChatCompletionTool[] {
  return tools.map((t) => ({
    type: 'function',
    function: {
      name: t.name,
      description: t.description,
      parameters: t.input_schema,
    },
  }))
}

// ----------------------------------------------------------------- Anthropic Client

class AnthropicProvider implements ProviderClient {
  type: ProviderType
  private client: Anthropic
  private abortController: AbortController | null = null

  constructor(type: 'anthropic' | 'anthropic_compat', apiKey: string, baseUrl?: string) {
    this.type = type
    this.client = new Anthropic({
      apiKey,
      baseURL: baseUrl ?? (type === 'anthropic' ? undefined : baseUrl),
    })
  }

  abort(): void {
    this.abortController?.abort()
  }

  async *chat(params: ChatParams): AsyncGenerator<StreamEvent> {
    this.abortController = new AbortController()

    try {
      const stream = this.client.messages.stream({
        model: params.model,
        max_tokens: params.maxTokens ?? 8192,
        system: params.system,
        messages: toAnthropicMessages(params.messages),
        tools: params.tools ? toAnthropicTools(params.tools) : undefined,
      }, { signal: this.abortController.signal })

      // Track tool_use blocks to emit correctly
      let currentToolUseId: string | null = null
      let currentToolName: string | null = null
      let currentToolInput: string = ''

      for await (const event of stream) {
        if (
          event.type === 'content_block_delta' &&
          event.delta.type === 'text_delta'
        ) {
          // Reset tool tracking when we get text
          currentToolUseId = null
          currentToolName = null
          currentToolInput = ''
          yield { type: 'text_delta', text: event.delta.text }
        } else if (
          event.type === 'content_block_start' &&
          event.content_block.type === 'tool_use'
        ) {
          currentToolUseId = event.content_block.id
          currentToolName = event.content_block.name
          currentToolInput = ''
        } else if (
          event.type === 'content_block_delta' &&
          event.delta.type === 'input_json_delta'
        ) {
          currentToolInput += event.delta.partial_json
        } else if (event.type === 'content_block_stop') {
          if (currentToolUseId) {
            try {
              const parsed = JSON.parse(currentToolInput)
              yield {
                type: 'tool_use',
                id: currentToolUseId,
                name: currentToolName ?? 'unknown',
                input: parsed,
              }
            } catch {
              yield {
                type: 'tool_use',
                id: currentToolUseId,
                name: currentToolName ?? 'unknown',
                input: currentToolInput,
              }
            }
            currentToolUseId = null
            currentToolName = null
            currentToolInput = ''
          }
        } else if (event.type === 'message_stop') {
          yield { type: 'message_stop' }
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      // AbortError is expected on cancel, don't treat as error
      if (message.includes('abort') || message.includes('AbortError')) {
        yield { type: 'message_stop' }
      } else {
        log.error('Anthropic stream error', err)
        yield { type: 'error', message }
      }
    }
  }
}

// ----------------------------------------------------------------- OpenAI Client

class OpenAIProvider implements ProviderClient {
  type: ProviderType = 'openai_compat'
  private client: OpenAI
  private abortController: AbortController | null = null

  constructor(apiKey: string, baseUrl?: string) {
    this.client = new OpenAI({
      apiKey,
      baseURL: baseUrl ?? 'https://api.openai.com/v1',
    })
  }

  abort(): void {
    this.abortController?.abort()
  }

  async *chat(params: ChatParams): AsyncGenerator<StreamEvent> {
    this.abortController = new AbortController()

    try {
      const stream = await this.client.chat.completions.create(
        {
          model: params.model,
          max_tokens: params.maxTokens ?? 8192,
          messages: toOpenAiMessages(params.messages, params.system),
          tools: params.tools ? toOpenAiTools(params.tools) : undefined,
          stream: true,
        },
        { signal: this.abortController.signal },
      )

      // Track tool calls across chunks
      const toolCalls: Map<number, { id: string; name: string; args: string }> = new Map()

      for await (const chunk of stream) {
        const delta = chunk.choices?.[0]?.delta as
          | {
              content?: string | null
              reasoning_content?: string | null
              tool_calls?: Array<{
                index: number
                id?: string
                function?: { name?: string; arguments?: string }
              }>
            }
          | undefined
        const rc = delta?.reasoning_content
        if (typeof rc === 'string' && rc.length > 0) {
          yield { type: 'reasoning_delta', text: rc }
        }

        const c = delta?.content
        if (typeof c === 'string' && c.length > 0) {
          yield { type: 'text_delta', text: c }
        }

        if (delta?.tool_calls) {
          for (const tc of delta.tool_calls) {
            const idx = tc.index ?? 0
            const entry = toolCalls.get(idx) ?? { id: '', name: '', args: '' }
            if (tc.id) entry.id = tc.id
            if (tc.function?.name) entry.name = tc.function.name
            if (tc.function?.arguments) entry.args += tc.function.arguments
            toolCalls.set(idx, entry)
          }
        }

        const finishReason = chunk.choices?.[0]?.finish_reason
        if (finishReason === 'tool_calls') {
          // Emit all accumulated tool calls
          const keys = Array.from(toolCalls.keys())
          for (const idx of keys) {
            const tc = toolCalls.get(idx)!
            try {
              const parsed = JSON.parse(tc.args)
              yield { type: 'tool_use', id: tc.id, name: tc.name, input: parsed }
            } catch {
              yield { type: 'tool_use', id: tc.id, name: tc.name, input: tc.args }
            }
          }
          toolCalls.clear()
        }

        if (finishReason === 'stop' || finishReason === 'length' || finishReason === 'content_filter') {
          yield { type: 'message_stop' }
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (message.includes('abort') || message.includes('AbortError')) {
        yield { type: 'message_stop' }
      } else {
        log.error('OpenAI stream error', err)
        yield { type: 'error', message }
      }
    }
  }
}

// ----------------------------------------------------------------- Factory

export function createClient(providerId: string): ProviderClient {
  const providers = store.get('providers')
  const config = providers.find((p) => p.id === providerId)

  if (!config) {
    throw new Error(`Provider '${providerId}' not found`)
  }

  // TODO: Decrypt apiKey with safeStorage before production
  const apiKey = config.apiKey
  const baseUrl = config.baseUrl

  switch (config.type) {
    case 'anthropic':
      return new AnthropicProvider('anthropic', apiKey)
    case 'anthropic_compat':
      return new AnthropicProvider('anthropic_compat', apiKey, baseUrl)
    case 'openai_compat':
      return new OpenAIProvider(apiKey, baseUrl)
    default:
      throw new Error(`Unsupported provider type: ${(config as { type: string }).type}`)
  }
}

export function getActiveClient(): ProviderClient | null {
  const activeId = store.get('activeProvider')
  if (!activeId) return null
  try {
    return createClient(activeId)
  } catch (err) {
    log.error('Failed to create active client', err)
    return null
  }
}
