import { describe, it, expect, beforeEach } from 'vitest'

import { useChatStore } from '../../src/renderer/src/stores/chatStore'
import type { Message, ToolCallEntry } from '../../src/renderer/src/stores/chatStore'

describe('useChatStore', () => {
  beforeEach(() => {
    useChatStore.setState({
      messages: [],
      agentStatus: 'idle',
      quoteText: null,
    })
  })

  describe('sendMessage', () => {
    it('appends a user message', () => {
      useChatStore.getState().sendMessage('Hello, world!')
      const { messages } = useChatStore.getState()
      expect(messages).toHaveLength(1)
      expect(messages[0].role).toBe('user')
      expect(messages[0].content).toBe('Hello, world!')
    })

    it('sets agentStatus to "running"', () => {
      useChatStore.getState().sendMessage('ping')
      expect(useChatStore.getState().agentStatus).toBe('running')
    })

    it('preserves existing messages when appending', () => {
      useChatStore.getState().sendMessage('first')
      useChatStore.getState().sendMessage('second')
      const { messages } = useChatStore.getState()
      expect(messages).toHaveLength(2)
      expect(messages[0].content).toBe('first')
      expect(messages[1].content).toBe('second')
    })

    it('assigns a unique id and a timestamp', () => {
      useChatStore.getState().sendMessage('time test')
      const msg = useChatStore.getState().messages[0]
      expect(msg.id).toBeTruthy()
      expect(typeof msg.timestamp).toBe('number')
      expect(msg.timestamp).toBeLessThanOrEqual(Date.now())
    })
  })

  describe('startAiMessage', () => {
    it('creates an empty AI message and returns its id', () => {
      const id = useChatStore.getState().startAiMessage()
      const { messages } = useChatStore.getState()
      expect(messages).toHaveLength(1)
      expect(messages[0].role).toBe('ai')
      expect(messages[0].content).toBe('')
      expect(messages[0].id).toBe(id)
    })

    it('sets agentStatus to "streaming"', () => {
      useChatStore.getState().startAiMessage()
      expect(useChatStore.getState().agentStatus).toBe('streaming')
    })
  })

  describe('appendToken', () => {
    it('appends a token to the matching AI message', () => {
      const id = useChatStore.getState().startAiMessage()
      useChatStore.getState().appendToken(id, 'Hel')
      useChatStore.getState().appendToken(id, 'lo')
      const msg = useChatStore.getState().messages.find((m) => m.id === id)
      expect(msg?.content).toBe('Hello')
    })

    it('does not modify non-matching messages', () => {
      const id = useChatStore.getState().startAiMessage()
      useChatStore.getState().appendToken('nonexistent-id', 'token')
      const msg = useChatStore.getState().messages.find((m) => m.id === id)
      expect(msg?.content).toBe('')
    })

    it('tokenizes character by character', () => {
      const id = useChatStore.getState().startAiMessage()
      for (const char of 'Hello World') {
        useChatStore.getState().appendToken(id, char)
      }
      const msg = useChatStore.getState().messages.find((m) => m.id === id)
      expect(msg?.content).toBe('Hello World')
    })
  })

  describe('cancelAgent', () => {
    it('sets agentStatus to "idle"', () => {
      useChatStore.getState().sendMessage('something')
      expect(useChatStore.getState().agentStatus).toBe('running')

      useChatStore.getState().cancelAgent()
      expect(useChatStore.getState().agentStatus).toBe('idle')
    })
  })

  describe('clearMessages', () => {
    it('removes all messages', () => {
      useChatStore.getState().sendMessage('msg1')
      useChatStore.getState().sendMessage('msg2')
      expect(useChatStore.getState().messages).toHaveLength(2)

      useChatStore.getState().clearMessages()
      expect(useChatStore.getState().messages).toHaveLength(0)
    })
  })

  describe('setAgentStatus', () => {
    it('sets agentStatus directly', () => {
      useChatStore.getState().setAgentStatus('error')
      expect(useChatStore.getState().agentStatus).toBe('error')

      useChatStore.getState().setAgentStatus('restarting')
      expect(useChatStore.getState().agentStatus).toBe('restarting')
    })
  })

  describe('setQuoteText', () => {
    it('sets quoteText', () => {
      useChatStore.getState().setQuoteText('quoted line')
      expect(useChatStore.getState().quoteText).toBe('quoted line')
    })

    it('clears quoteText with null', () => {
      useChatStore.getState().setQuoteText('temp')
      useChatStore.getState().setQuoteText(null)
      expect(useChatStore.getState().quoteText).toBeNull()
    })
  })

  describe('addToolCallToAiMessage', () => {
    it('adds a tool call entry to a matching AI message', () => {
      const id = useChatStore.getState().startAiMessage()
      const tc: ToolCallEntry = {
        id: 'tc-1',
        name: 'search',
        input: { query: 'test' },
      }
      useChatStore.getState().addToolCallToAiMessage(id, tc)

      const msg = useChatStore.getState().messages.find((m) => m.id === id)
      expect(msg?.toolCalls).toHaveLength(1)
      expect(msg?.toolCalls?.[0].name).toBe('search')
    })

    it('appends multiple tool calls to the same message', () => {
      const id = useChatStore.getState().startAiMessage()
      useChatStore.getState().addToolCallToAiMessage(id, {
        id: 'tc-1',
        name: 'read',
        input: {},
      })
      useChatStore.getState().addToolCallToAiMessage(id, {
        id: 'tc-2',
        name: 'grep',
        input: {},
      })
      const msg = useChatStore.getState().messages.find((m) => m.id === id)
      expect(msg?.toolCalls).toHaveLength(2)
    })

    it('does not modify other messages', () => {
      useChatStore.getState().sendMessage('user msg')
      const aiId = useChatStore.getState().startAiMessage()
      useChatStore.getState().addToolCallToAiMessage(aiId, {
        id: 'tc-1',
        name: 'search',
        input: {},
      })
      const userMsg = useChatStore.getState().messages.find((m) => m.role === 'user')
      expect(userMsg?.toolCalls).toBeUndefined()
    })
  })

  describe('updateToolCallResult', () => {
    it('updates output and isError on a matching tool call', () => {
      const id = useChatStore.getState().startAiMessage()
      useChatStore.getState().addToolCallToAiMessage(id, {
        id: 'tc-1',
        name: 'search',
        input: {},
      })
      useChatStore.getState().updateToolCallResult(id, 'tc-1', { found: 42 }, false)

      const msg = useChatStore.getState().messages.find((m) => m.id === id)
      const tc = msg?.toolCalls?.[0]
      expect(tc?.output).toEqual({ found: 42 })
      expect(tc?.isError).toBe(false)
    })

    it('sets isError=true when the tool call errored', () => {
      const id = useChatStore.getState().startAiMessage()
      useChatStore.getState().addToolCallToAiMessage(id, {
        id: 'tc-err',
        name: 'bad-tool',
        input: {},
      })
      useChatStore.getState().updateToolCallResult(
        id,
        'tc-err',
        'File not found',
        true,
      )

      const msg = useChatStore.getState().messages.find((m) => m.id === id)
      expect(msg?.toolCalls?.[0].isError).toBe(true)
    })
  })
})
