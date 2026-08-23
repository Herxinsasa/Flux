import { describe, expect, it } from 'vitest'
import {
  DEEPSEEK_MODEL_IDS,
  inferPresetKeyFromProvider,
  isRetiredModelSuggestion,
  mergeCurrentModelOption,
  providerModelOptionsKey,
  trustedProviderModelOptions,
} from '../../src/renderer/src/config/providerModels'

describe('provider model settings', () => {
  it('keeps a custom Anthropic-native provider classified as custom', () => {
    expect(inferPresetKeyFromProvider({
      id: 'provider-custom',
      name: '自定义',
      type: 'anthropic',
      apiKey: 'test-key',
      baseUrl: 'http://api.ai.isv-tech.lan',
      model: 'claude-custom',
    })).toBe('custom')
  })

  it('keeps legacy custom protocol names classified as custom', () => {
    expect(inferPresetKeyFromProvider({
      id: 'provider-legacy',
      name: 'Anthropic Native Messages',
      type: 'anthropic',
      apiKey: 'test-key',
      model: 'claude-custom',
    })).toBe('custom')
  })

  it('keeps user-named models even when they are not built in', () => {
    expect(mergeCurrentModelOption('company-model-v1', ['gpt-5.5']))
      .toEqual(['company-model-v1', 'gpt-5.5'])
  })

  it('uses current DeepSeek V4 model suggestions only', () => {
    expect(DEEPSEEK_MODEL_IDS).toEqual(['deepseek-v4-flash', 'deepseek-v4-pro'])
  })

  it('filters retired built-in suggestions without rejecting custom model names', () => {
    expect(isRetiredModelSuggestion('deepseek-chat')).toBe(true)
    expect(isRetiredModelSuggestion('company-model-v1')).toBe(false)
  })

  it('scopes custom model caches by protocol and normalized endpoint', () => {
    expect(providerModelOptionsKey('custom', 'openai_compat', 'http://api-a.lan/v1/models'))
      .toBe('custom:openai_compat:http://api-a.lan/v1')
    expect(providerModelOptionsKey('custom', 'openai_compat', 'http://api-b.lan'))
      .toBe('custom:openai_compat:http://api-b.lan/v1')
    expect(providerModelOptionsKey('custom', 'anthropic', 'http://api-a.lan/v1/messages'))
      .toBe('custom:anthropic:http://api-a.lan')
  })

  it('keeps preset model caches backward compatible', () => {
    expect(providerModelOptionsKey('deepseek', 'openai_compat', 'https://example.invalid'))
      .toBe('deepseek')
  })

  it('ignores persisted models after credentials change until refresh succeeds', () => {
    const options = {
      'custom:openai_compat:http://api-a.lan/v1': ['tenant-a-model'],
    }
    const key = providerModelOptionsKey('custom', 'openai_compat', 'http://api-a.lan')

    expect(trustedProviderModelOptions(options, key, true)).toEqual(['tenant-a-model'])
    expect(trustedProviderModelOptions(options, key, false)).toEqual([])
  })
})
