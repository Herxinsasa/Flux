export type ProviderProtocol = 'anthropic' | 'anthropic_compat' | 'openai_compat'

function trimEndpointSuffix(value: string, suffix: RegExp): string {
  return value.replace(/\/+$/g, '').replace(suffix, '')
}

export function normalizeAnthropicBaseUrl(baseUrl?: string): string {
  const raw = (baseUrl || 'https://api.anthropic.com').trim()
  return trimEndpointSuffix(raw, /\/v1\/(?:messages|models)$/i).replace(/\/v1$/i, '')
}

export function normalizeOpenAiCompatibleBaseUrl(baseUrl?: string): string {
  const raw = trimEndpointSuffix((baseUrl || 'https://api.openai.com').trim(), /\/(?:chat\/completions|models)$/i)
  if (/\/(?:v\d+|compatible-mode\/v\d+)$/i.test(raw)) return raw
  return `${raw}/v1`
}

export function providerModelsEndpoint(type: ProviderProtocol, baseUrl?: string): string {
  if (type === 'anthropic' || type === 'anthropic_compat') {
    return `${normalizeAnthropicBaseUrl(baseUrl)}/v1/models`
  }
  return `${normalizeOpenAiCompatibleBaseUrl(baseUrl)}/models`
}

export function providerChatEndpoint(type: ProviderProtocol, baseUrl?: string): string {
  if (type === 'anthropic' || type === 'anthropic_compat') {
    return `${normalizeAnthropicBaseUrl(baseUrl)}/v1/messages`
  }
  return `${normalizeOpenAiCompatibleBaseUrl(baseUrl)}/chat/completions`
}
