import { describe, expect, it } from 'vitest'
import {
  normalizeReadingPreferences,
  resolveInitialTheme,
} from '../../src/renderer/src/stores/settingsStore'

describe('startup theme', () => {
  it('uses the injected light theme and safely falls back to dark', () => {
    expect(resolveInitialTheme('light')).toBe('light')
    expect(resolveInitialTheme('dark')).toBe('dark')
    expect(resolveInitialTheme(undefined)).toBe('dark')
    expect(resolveInitialTheme('system')).toBe('dark')
  })
})

describe('reading preferences', () => {
  it('clamps font sizes and rejects unsafe CSS font values', () => {
    const preferences = normalizeReadingPreferences({
      uiFontFamily: 'unsafe; color: red',
      bodyFontSize: 99,
      codeFontSize: 1,
    })

    expect(preferences.uiFontFamily).toBe('Microsoft YaHei')
    expect(preferences.bodyFontSize).toBe(40)
    expect(preferences.codeFontSize).toBe(6)
  })
})
