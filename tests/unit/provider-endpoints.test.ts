import { describe, expect, it } from 'vitest'
import {
  normalizeAnthropicBaseUrl,
  normalizeOpenAiCompatibleBaseUrl,
  providerChatEndpoint,
  providerModelsEndpoint,
} from '../../src/shared/provider-endpoints'

describe('provider endpoint normalization', () => {
  it.each([
    ['http://api.ai.isv-tech.lan', 'http://api.ai.isv-tech.lan/v1'],
    ['http://api.ai.isv-tech.lan/v1', 'http://api.ai.isv-tech.lan/v1'],
    ['http://api.ai.isv-tech.lan/v1/chat/completions', 'http://api.ai.isv-tech.lan/v1'],
    ['https://open.bigmodel.cn/api/paas/v4', 'https://open.bigmodel.cn/api/paas/v4'],
  ])('normalizes OpenAI-compatible base URL %s', (input, expected) => {
    expect(normalizeOpenAiCompatibleBaseUrl(input)).toBe(expected)
  })

  it('builds model and chat endpoints from an internal NewAPI root', () => {
    const baseUrl = 'http://api.ai.isv-tech.lan'
    expect(providerModelsEndpoint('openai_compat', baseUrl)).toBe(`${baseUrl}/v1/models`)
    expect(providerChatEndpoint('openai_compat', baseUrl)).toBe(`${baseUrl}/v1/chat/completions`)
  })

  it('accepts Anthropic roots and complete endpoint URLs', () => {
    expect(normalizeAnthropicBaseUrl('http://api.ai.isv-tech.lan/v1/messages')).toBe('http://api.ai.isv-tech.lan')
    expect(providerModelsEndpoint('anthropic', 'http://api.ai.isv-tech.lan/v1')).toBe('http://api.ai.isv-tech.lan/v1/models')
  })
})
