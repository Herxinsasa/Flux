import { create } from 'zustand'
import { MAX_UI_MESSAGES, MAX_UI_TOOL_OUTPUT_CHARS } from '../../../shared/context-budget'

export interface ToolCallEntry {
  id: string
  name: string
  input: unknown
  output?: unknown
  isError?: boolean
}

export interface Message {
  id: string
  role: 'user' | 'ai'
  content: string
  /** 思考链文本（如 DeepSeek reasoning），多轮对话需随 assistant 回传 API */
  reasoningContent?: string
  toolCalls?: ToolCallEntry[]
  timestamp: number
  /** 与输入区 @ / 引用 chips 一致的上下文说明（仅展示用） */
  contextFootnote?: string
}

export type AgentStatus = 'idle' | 'running' | 'streaming' | 'restarting' | 'error'

export interface QuoteRange {
  startLine: number
  endLine: number
}

export interface QuoteItem {
  id: string
  text: string
  range: QuoteRange | null
  sourceLabel?: string
}

interface ChatState {
  messages: Message[]
  agentStatus: AgentStatus
  quotes: QuoteItem[]
  inputHistory: string[]
  quoteText: string | null
  quoteRange: QuoteRange | null
  sendMessage: (content: string, opts?: { contextFootnote?: string }) => Message
  restoreMessages: (messages: Message[]) => void
  startAiMessage: () => string
  appendToken: (messageId: string, token: string) => void
  appendReasoningToken: (messageId: string, token: string) => void
  addToolCallToAiMessage: (messageId: string, toolCall: ToolCallEntry) => void
  updateToolCallResult: (
    messageId: string,
    toolCallId: string,
    output: unknown,
    isError?: boolean,
  ) => void
  finalizePendingToolCalls: (messageId: string, reason: string) => void
  setAgentStatus: (status: AgentStatus) => void
  setQuoteText: (text: string | null) => void
  setQuoteRange: (range: QuoteRange | null) => void
  appendQuote: (quote: { text: string; range?: QuoteRange | null; sourceLabel?: string }) => void
  removeQuote: (quoteId: string) => void
  clearQuotes: () => void
  pushInputHistory: (text: string) => void
  cancelAgent: () => void
  clearMessages: () => void
  /** 新建对话：清 messages，保留工作区/打开文件；不清 pinned（P3） */
  newConversation: () => void
  summarizeToolOutputs: () => void
}

function pruneUiMessages(messages: Message[]): Message[] {
  if (messages.length <= MAX_UI_MESSAGES) return messages
  return messages.slice(-MAX_UI_MESSAGES)
}

function summarizeOutput(output: unknown): unknown {
  if (output === undefined || output === null) return output
  const text = typeof output === 'string' ? output : JSON.stringify(output)
  if (text.length <= MAX_UI_TOOL_OUTPUT_CHARS) return output
  return `${text.slice(0, MAX_UI_TOOL_OUTPUT_CHARS)}… [${text.length} chars]`
}

export const useChatStore = create<ChatState>((set, get) => ({
  messages: [],
  agentStatus: 'idle',
  quotes: [],
  inputHistory: [],
  quoteText: null,
  quoteRange: null,

  sendMessage: (content, opts) => {
    const message: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      content,
      contextFootnote: opts?.contextFootnote,
      timestamp: Date.now(),
    }
    set((state) => ({
      agentStatus: 'running',
      messages: pruneUiMessages([...state.messages, message]),
    }))
    return message
  },

  restoreMessages: (messages) => set({
    messages: pruneUiMessages(messages),
    agentStatus: 'idle',
  }),

  startAiMessage: () => {
    const id = crypto.randomUUID()
    set((state) => ({
      agentStatus: 'streaming',
      messages: pruneUiMessages([
        ...state.messages,
        { id, role: 'ai', content: '', timestamp: Date.now() },
      ]),
    }))
    return id
  },

  appendToken: (messageId, token) =>
    set((state) => ({
      messages: state.messages.map((m) =>
        m.id === messageId ? { ...m, content: m.content + token } : m,
      ),
    })),

  appendReasoningToken: (messageId, token) =>
    set((state) => ({
      messages: state.messages.map((m) =>
        m.id === messageId
          ? { ...m, reasoningContent: (m.reasoningContent ?? '') + token }
          : m,
      ),
    })),

  addToolCallToAiMessage: (messageId, toolCall) =>
    set((state) => ({
      messages: state.messages.map((m) =>
        m.id === messageId
          ? { ...m, toolCalls: [...(m.toolCalls ?? []), toolCall] }
          : m,
      ),
    })),

  updateToolCallResult: (messageId, toolCallId, output, isError) =>
    set((state) => ({
      messages: state.messages.map((m) =>
        m.id === messageId
          ? {
              ...m,
              toolCalls: (m.toolCalls ?? []).map((tc) =>
                tc.id === toolCallId ? { ...tc, output, isError } : tc,
              ),
            }
          : m,
      ),
    })),

  finalizePendingToolCalls: (messageId, reason) =>
    set((state) => ({
      messages: state.messages.map((m) =>
        m.id === messageId
          ? {
              ...m,
              toolCalls: (m.toolCalls ?? []).map((tc) =>
                tc.output === undefined
                  ? {
                      ...tc,
                      output: `[Tool interrupted] ${reason}`,
                      isError: true,
                    }
                  : tc,
              ),
            }
          : m,
      ),
    })),

  setAgentStatus: (agentStatus) => set({ agentStatus }),

  setQuoteText: (quoteText) =>
    set((state) => {
      if (!quoteText) {
        return { quoteText: null, quoteRange: null, quotes: [] }
      }
      const item: QuoteItem = {
        id: crypto.randomUUID(),
        text: quoteText,
        range: state.quoteRange,
      }
      return {
        quoteText,
        quotes: [item],
      }
    }),

  setQuoteRange: (quoteRange) =>
    set((state) => {
      if (state.quotes.length === 0) {
        return { quoteRange }
      }
      const lastIndex = state.quotes.length - 1
      const nextQuotes = state.quotes.map((q, i) => (i === lastIndex ? { ...q, range: quoteRange } : q))
      return { quoteRange, quotes: nextQuotes }
    }),

  appendQuote: ({ text, range, sourceLabel }) =>
    set((state) => {
      const normalized = text.trim()
      if (!normalized) return state
      const exists = state.quotes.some((q) => q.text.trim() === normalized)
      if (exists) return state

      const nextQuotes = [
        ...state.quotes,
        {
          id: crypto.randomUUID(),
          text,
          range: range ?? null,
          sourceLabel,
        },
      ].slice(-5)

      const last = nextQuotes[nextQuotes.length - 1] ?? null
      return {
        quotes: nextQuotes,
        quoteText: last?.text ?? null,
        quoteRange: last?.range ?? null,
      }
    }),

  removeQuote: (quoteId) =>
    set((state) => {
      const nextQuotes = state.quotes.filter((q) => q.id !== quoteId)
      const last = nextQuotes[nextQuotes.length - 1] ?? null
      return {
        quotes: nextQuotes,
        quoteText: last?.text ?? null,
        quoteRange: last?.range ?? null,
      }
    }),

  clearQuotes: () => set({ quotes: [], quoteText: null, quoteRange: null }),

  pushInputHistory: (text) =>
    set((state) => {
      const normalized = text.trim()
      if (!normalized) return state
      const deduped = state.inputHistory.filter((item) => item !== normalized)
      return {
        inputHistory: [...deduped, normalized].slice(-5),
      }
    }),

  cancelAgent: () => set({ agentStatus: 'idle' }),

  clearMessages: () => set({ messages: [], inputHistory: [] }),

  newConversation: () =>
    set({
      messages: [],
      inputHistory: [],
      quotes: [],
      quoteText: null,
      quoteRange: null,
      agentStatus: 'idle',
    }),

  summarizeToolOutputs: () =>
    set((state) => ({
      messages: state.messages.map((m) => {
        if (m.role !== 'ai' || !m.toolCalls?.length) return m
        return {
          ...m,
          toolCalls: m.toolCalls.map((tc) =>
            tc.output === undefined
              ? tc
              : { ...tc, output: summarizeOutput(tc.output) },
          ),
        }
      }),
    })),
}))
