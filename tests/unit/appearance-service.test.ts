import { describe, expect, it, vi } from 'vitest'
import {
  AppearanceService,
  AppearanceValidationError,
} from '../../src/main/services/appearance-service'

function createStore() {
  let data: Record<string, any> = {
    theme: 'dark',
    readingPreferences: {
      uiFontFamily: 'Chinese UI',
      editorFontFamily: 'Chinese Editor',
      monoFontFamily: 'Old',
      bodyFontSize: 14,
      codeFontSize: 13,
    },
    providers: [{ apiKey: 'private' }],
  }
  const store = {
    get: (key: string) => data[key],
    set: vi.fn((values: Record<string, unknown>) => {
      data = { ...data, ...values }
    }),
  }
  return { store, current: () => data }
}

describe('appearance service', () => {
  it('migrates only the code font once in one write and preserves later customization', () => {
    const { store, current } = createStore()
    const service = new AppearanceService(store)
    expect(service.snapshot().readingPreferences).toMatchObject({
      uiFontFamily: 'Chinese UI',
      editorFontFamily: 'Chinese Editor',
      monoFontFamily: 'Cascadia Mono',
      bodyFontSize: 16,
      codeFontSize: 13,
    })
    expect(current().readingPreferences.bodyFontSize).toBe(14)
    expect(store.set).toHaveBeenCalledOnce()
    expect(store.set).toHaveBeenCalledWith(
      expect.objectContaining({
        codeFontMigrationVersion: 1,
        readingPreferences: expect.objectContaining({ monoFontFamily: 'Cascadia Mono' }),
      }),
    )
    service.update({ readingPreferences: { monoFontFamily: 'Custom Mono' } })
    expect(new AppearanceService(store).snapshot().readingPreferences.monoFontFamily).toBe(
      'Custom Mono',
    )
    expect(current().providers).toEqual([{ apiKey: 'private' }])
  })

  it('preserves legacy body display without changing disk until the user explicitly changes it', () => {
    const { store, current } = createStore()
    const service = new AppearanceService(store)
    expect(service.snapshot().readingPreferences.bodyFontSize).toBe(16)
    expect(
      service.update({ readingPreferences: { codeFontSize: 20 } }).readingPreferences.bodyFontSize,
    ).toBe(16)
    expect(current().readingPreferences.bodyFontSize).toBe(14)
    expect(
      service.update({ readingPreferences: { bodyFontSize: 14 } }).readingPreferences.bodyFontSize,
    ).toBe(14)
    expect(service.snapshot().readingPreferences.bodyFontSize).toBe(14)
    expect(new AppearanceService(store).snapshot().readingPreferences.bodyFontSize).toBe(16)
    expect(current().readingPreferences.bodyFontSize).toBe(14)
  })

  it('merges partial updates and broadcasts monotonic snapshots without unrelated settings', () => {
    const { store } = createStore()
    const service = new AppearanceService(store)
    service.snapshot()
    const listener = vi.fn()
    service.subscribe(listener)
    service.update({ readingPreferences: { bodyFontSize: 18 } })
    service.update({ theme: 'light', readingPreferences: { codeFontSize: 20 } })
    expect(listener).toHaveBeenCalledTimes(2)
    expect(listener.mock.calls[1][0]).toMatchObject({
      revision: 2,
      theme: 'light',
      readingPreferences: { bodyFontSize: 18, codeFontSize: 20 },
    })
    expect(Object.keys(listener.mock.calls[1][0]).sort()).toEqual([
      'readingPreferences',
      'revision',
      'theme',
    ])
    service.update({ theme: 'dark' })
    expect(store.set).toHaveBeenLastCalledWith({ theme: 'dark' })
  })

  it('leaves migration retryable after write failure and does not broadcast a failed update', () => {
    const { store, current } = createStore()
    store.set.mockImplementationOnce(() => {
      throw new Error('disk failed')
    })
    const service = new AppearanceService(store)
    expect(() => service.snapshot()).toThrow('disk failed')
    expect(current()).not.toHaveProperty('codeFontMigrationVersion')
    expect(current().readingPreferences.monoFontFamily).toBe('Old')
    service.snapshot()
    const listener = vi.fn()
    service.subscribe(listener)
    store.set.mockImplementationOnce(() => {
      throw new Error('disk failed')
    })
    expect(() => service.update({ theme: 'light' })).toThrow('disk failed')
    expect(service.snapshot()).toMatchObject({ revision: 0, theme: 'dark' })
    expect(listener).not.toHaveBeenCalled()
  })

  it('rejects invalid fields before persisting anything', () => {
    const { store } = createStore()
    const service = new AppearanceService(store)
    expect(() => service.update({ readingPreferences: { codeFontSize: -1 } })).toThrow(
      AppearanceValidationError,
    )
    expect(store.set).not.toHaveBeenCalled()
  })
})
