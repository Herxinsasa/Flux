import { describe, expect, it } from 'vitest'
import { parseProviderModelList, parseProviderModelPage } from '../../src/shared/provider-model-list'

describe('provider model list parser', () => {
  it('normalizes OpenAI/Anthropic data and removes invalid duplicates', () => {
    expect(parseProviderModelList({ data: [
      { id: ' model-b ' },
      { id: 'model-a' },
      { id: 'model-a' },
      { id: 12 },
    ] })).toEqual(['model-a', 'model-b'])
  })

  it('supports a plain models array and rejects malformed payloads', () => {
    expect(parseProviderModelList({ models: ['z', { id: 'a' }] })).toEqual(['a', 'z'])
    expect(parseProviderModelList({ data: 'not-an-array' })).toEqual([])
    expect(parseProviderModelList(null)).toEqual([])
  })

  it('exposes pagination metadata without mixing it into model ids', () => {
    expect(parseProviderModelPage({ data: [{ id: 'm1' }], has_more: true, last_id: 'cursor-1' })).toEqual({
      models: ['m1'],
      hasMore: true,
      lastId: 'cursor-1',
    })
  })
})
