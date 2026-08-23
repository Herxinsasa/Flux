import { describe, expect, it } from 'vitest'
import { migrateStoreSchema, normalizeReadingPreferences } from '../../src/main/store/schema'

describe('store schema migration', () => {
  it('adds onboarding state without overwriting existing settings', () => {
    const values = new Map<string, unknown>([
      ['theme', 'light'],
      ['providers', [{ id: 'custom', apiKey: 'key' }]],
    ])
    const store = {
      has: (key: string) => values.has(key),
      set: (key: string, value: unknown) => values.set(key, value),
    }

    migrateStoreSchema(store)

    expect(values.get('theme')).toBe('light')
    expect(values.get('providers')).toEqual([{ id: 'custom', apiKey: 'key' }])
    expect(values.get('onboardingCompleted')).toBe(false)
    expect(values.get('schemaVersion')).toBe(2)
  })
})

it('normalizes persisted reading preferences into supported ranges', () => {
  expect(normalizeReadingPreferences({ bodyFontSize: 4, codeFontSize: 50 })).toMatchObject({
    bodyFontSize: 8,
    codeFontSize: 36,
  })
})
