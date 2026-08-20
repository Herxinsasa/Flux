import { beforeEach, describe, expect, it } from 'vitest'
import {
  applyMarkdownZoomAction,
  getMarkdownZoomAction,
  getMarkdownZoomPercent,
} from '../../src/renderer/src/hooks/useShortcuts'
import { useEditorStore } from '../../src/renderer/src/stores/editorStore'
import {
  DEFAULT_READING_PREFERENCES,
  migrateLegacyReadingPreferences,
  useSettingsStore,
} from '../../src/renderer/src/stores/settingsStore'

describe('Markdown content zoom', () => {
  beforeEach(() => {
    useEditorStore.setState({ mode: 'markdown', markdownEditSurface: 'wysiwyg' })
    useSettingsStore.getState().setReadingPreferences(DEFAULT_READING_PREFERENCES)
  })

  it('maps the documented shortcuts and ignores unmodified keys', () => {
    expect(getMarkdownZoomAction({ ctrlKey: true, metaKey: false, key: '=' })).toBe('in')
    expect(getMarkdownZoomAction({ ctrlKey: true, metaKey: false, key: '-' })).toBe('out')
    expect(getMarkdownZoomAction({ ctrlKey: false, metaKey: true, key: '0' })).toBe('reset')
    expect(getMarkdownZoomAction({ ctrlKey: false, metaKey: false, key: '=' })).toBeNull()
  })

  it('zooms live and source editing together and reports the shared percentage', () => {
    applyMarkdownZoomAction('in')

    const base = DEFAULT_READING_PREFERENCES
    expect(useSettingsStore.getState().readingPreferences.bodyFontSize).toBe(base.bodyFontSize + 1)
    expect(useSettingsStore.getState().readingPreferences.codeFontSize).toBe(base.codeFontSize + 1)
    expect(getMarkdownZoomPercent()).toBe(Math.round(((base.bodyFontSize + 1) / base.bodyFontSize) * 100))
  })

  it('keeps source editing bound to the same markdown zoom', () => {
    useEditorStore.setState({ markdownEditSurface: 'source' })
    applyMarkdownZoomAction('in')
    applyMarkdownZoomAction('in')
    const base = DEFAULT_READING_PREFERENCES
    expect(useSettingsStore.getState().readingPreferences.bodyFontSize).toBe(base.bodyFontSize + 2)
    expect(useSettingsStore.getState().readingPreferences.codeFontSize).toBe(base.codeFontSize + 2)

    applyMarkdownZoomAction('reset')
    expect(useSettingsStore.getState().readingPreferences.codeFontSize).toBe(base.codeFontSize)
    expect(useSettingsStore.getState().readingPreferences.bodyFontSize).toBe(base.bodyFontSize)
  })

  it('clamps both zoom directions to the existing preference limits', () => {
    useSettingsStore.getState().setReadingPreferences({ bodyFontSize: 24 })
    applyMarkdownZoomAction('in')
    expect(useSettingsStore.getState().readingPreferences.bodyFontSize).toBe(24)

    useSettingsStore.getState().setReadingPreferences({ bodyFontSize: 12 })
    applyMarkdownZoomAction('out')
    expect(useSettingsStore.getState().readingPreferences.bodyFontSize).toBe(12)
  })

  it('lets zoom shrink below the legacy default without bouncing back', () => {
    // 实时缩放路径不得改写用户输入：16 → 15 → 14 必须可达（回归：迁移逻辑误入 normalizeReadingPreferences 时 14 会被弹回 16）
    useSettingsStore.getState().setReadingPreferences({ bodyFontSize: 15 })
    applyMarkdownZoomAction('out')
    expect(useSettingsStore.getState().readingPreferences.bodyFontSize).toBe(14)
    applyMarkdownZoomAction('out')
    expect(useSettingsStore.getState().readingPreferences.bodyFontSize).toBe(13)
    applyMarkdownZoomAction('out')
    expect(useSettingsStore.getState().readingPreferences.bodyFontSize).toBe(12)
    applyMarkdownZoomAction('out')
    expect(useSettingsStore.getState().readingPreferences.bodyFontSize).toBe(12)
  })

  it('migrates only persisted legacy values, leaving user-tuned sizes intact', () => {
    const base = { ...DEFAULT_READING_PREFERENCES }
    // 旧默认 14 → 新默认 16（仅加载边界迁移）
    expect(migrateLegacyReadingPreferences({ ...base, bodyFontSize: 14 }).bodyFontSize).toBe(base.bodyFontSize)
    // 用户主动设置的 15/13 等值不受影响
    expect(migrateLegacyReadingPreferences({ ...base, bodyFontSize: 15 }).bodyFontSize).toBe(15)
    expect(migrateLegacyReadingPreferences({ ...base, bodyFontSize: 13 }).bodyFontSize).toBe(13)
  })
})
