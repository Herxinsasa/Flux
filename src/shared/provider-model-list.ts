export interface ProviderModelPage {
  models: string[]
  hasMore: boolean
  lastId: string | null
}

export function parseProviderModelPage(payload: unknown): ProviderModelPage {
  if (!payload || typeof payload !== 'object') return { models: [], hasMore: false, lastId: null }
  const data = payload as { data?: unknown; models?: unknown }
  const source = Array.isArray(data.data) ? data.data : Array.isArray(data.models) ? data.models : []
  const models = [...new Set(source.slice(0, 10_000).flatMap((item) => {
    const id = typeof item === 'string'
      ? item
      : item && typeof item === 'object'
        ? (item as { id?: unknown }).id
        : undefined
    return typeof id === 'string' && id.trim() ? [id.trim()] : []
  }))].sort((left, right) => left.localeCompare(right))
  const metadata = payload as { has_more?: unknown; last_id?: unknown }
  return {
    models,
    hasMore: metadata.has_more === true,
    lastId: typeof metadata.last_id === 'string' && metadata.last_id ? metadata.last_id : null,
  }
}

export function parseProviderModelList(payload: unknown): string[] {
  return parseProviderModelPage(payload).models
}
