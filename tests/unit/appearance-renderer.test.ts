import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.resetModules()
})

describe('renderer appearance snapshots', () => {
  it('ignores old snapshots and prevents a delayed settings read from replacing the newest appearance', async () => {
    let finishSettings: ((value: unknown) => void) | undefined
    const settings = new Promise((resolve) => {
      finishSettings = resolve
    })
    Object.defineProperty(window, 'electronAPI', {
      configurable: true,
      value: { settings: { get: () => settings }, appearance: { update: vi.fn() } },
    })
    const { useSettingsStore, DEFAULT_READING_PREFERENCES } =
      await import('../../src/renderer/src/stores/settingsStore')
    const next = {
      revision: 2,
      theme: 'light' as const,
      readingPreferences: { ...DEFAULT_READING_PREFERENCES, codeFontSize: 20 },
    }
    useSettingsStore.getState().applyAppearance(next)
    useSettingsStore.getState().applyAppearance({
      ...next,
      revision: 1,
      theme: 'dark',
      readingPreferences: { ...next.readingPreferences, codeFontSize: 9 },
    })
    finishSettings?.({
      success: true,
      data: {
        theme: 'dark',
        readingPreferences: { ...DEFAULT_READING_PREFERENCES, codeFontSize: 8 },
      },
    })
    await settings
    await Promise.resolve()
    expect(useSettingsStore.getState()).toMatchObject({
      theme: 'light',
      appearanceRevision: 2,
      readingPreferences: { codeFontSize: 20 },
    })
  })

  it('restores the last confirmed snapshot after a failed write', async () => {
    const update = vi.fn().mockResolvedValue({ success: false, error: 'disk failed' })
    const alert = vi.spyOn(window, 'alert').mockImplementation(() => undefined)
    Object.defineProperty(window, 'electronAPI', {
      configurable: true,
      value: {
        settings: { get: () => Promise.resolve({ success: false }) },
        appearance: { update },
      },
    })
    const { useSettingsStore, DEFAULT_READING_PREFERENCES } =
      await import('../../src/renderer/src/stores/settingsStore')
    useSettingsStore.getState().applyAppearance({
      revision: 1,
      theme: 'dark',
      readingPreferences: DEFAULT_READING_PREFERENCES,
    })
    useSettingsStore.getState().setReadingPreferences({ codeFontSize: 22 })
    await vi.waitFor(() => expect(alert).toHaveBeenCalledWith('disk failed'))
    expect(useSettingsStore.getState().readingPreferences.codeFontSize).toBe(
      DEFAULT_READING_PREFERENCES.codeFontSize,
    )
    expect(update).toHaveBeenCalledWith({ readingPreferences: { codeFontSize: 22 } })
    alert.mockRestore()
  })

  it('keeps a newer confirmed update when an older write fails late', async () => {
    const pending: Array<(result: unknown) => void> = []
    const update = vi.fn(
      () =>
        new Promise((resolve) => {
          pending.push(resolve)
        }),
    )
    const alert = vi.spyOn(window, 'alert').mockImplementation(() => undefined)
    Object.defineProperty(window, 'electronAPI', {
      configurable: true,
      value: {
        settings: { get: () => Promise.resolve({ success: false }) },
        appearance: { update },
      },
    })
    const { useSettingsStore, DEFAULT_READING_PREFERENCES } =
      await import('../../src/renderer/src/stores/settingsStore')
    useSettingsStore.getState().applyAppearance({
      revision: 0,
      theme: 'dark',
      readingPreferences: DEFAULT_READING_PREFERENCES,
    })
    useSettingsStore.getState().setReadingPreferences({ bodyFontSize: 18 })
    useSettingsStore.getState().setReadingPreferences({ codeFontSize: 20 })
    useSettingsStore.getState().applyAppearance({
      revision: 2,
      theme: 'light',
      readingPreferences: { ...DEFAULT_READING_PREFERENCES, codeFontSize: 20 },
    })
    pending[0]({ success: false, error: 'earlier write failed' })
    pending[1]({ success: true, data: { revision: 2 } })
    await vi.waitFor(() => expect(alert).toHaveBeenCalledWith('earlier write failed'))
    expect(useSettingsStore.getState()).toMatchObject({
      theme: 'light',
      appearanceRevision: 2,
      readingPreferences: { codeFontSize: 20 },
    })
    alert.mockRestore()
  })
})
