import { describe, expect, it } from 'vitest'
import { normalizeReadingPreferences } from '../../src/renderer/src/stores/settingsStore'

describe('reading preferences', () => {
  it('clamps font sizes and rejects unsafe CSS font values', () => {
    const preferences = normalizeReadingPreferences({
      uiFontFamily: 'unsafe; color: red',
      bodyFontSize: 99,
      codeFontSize: 1,
    })

    expect(preferences.uiFontFamily).toBe('Microsoft YaHei')
    expect(preferences.bodyFontSize).toBe(24)
    expect(preferences.codeFontSize).toBe(11)
  })
})
