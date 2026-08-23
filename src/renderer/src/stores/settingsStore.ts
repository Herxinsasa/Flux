import { create } from 'zustand'

type Theme = 'dark' | 'light'

export function resolveInitialTheme(value: unknown): Theme {
  return value === 'light' ? 'light' : 'dark'
}

function getInitialTheme(): Theme {
  return resolveInitialTheme(
    typeof document === 'undefined' ? undefined : document.documentElement.dataset.theme,
  )
}

export interface ReadingPreferences {
  uiFontFamily: string
  editorFontFamily: string
  monoFontFamily: string
  bodyFontSize: number
  codeFontSize: number
}

export interface Provider {
  id: string
  name: string
  type: 'anthropic' | 'anthropic_compat' | 'openai_compat'
  apiKey: string
  baseUrl?: string
  model: string
}

export const DEFAULT_READING_PREFERENCES: ReadingPreferences = {
  uiFontFamily: 'Microsoft YaHei',
  editorFontFamily: 'Microsoft YaHei',
  monoFontFamily: 'Consolas',
  bodyFontSize: 16,
  codeFontSize: 13,
}

export const READING_BODY_FONT_SIZE_MIN = 8
export const READING_BODY_FONT_SIZE_MAX = 40
export const READING_CODE_FONT_SIZE_MIN = 6
export const READING_CODE_FONT_SIZE_MAX = 36

const FONT_FALLBACKS = {
  ui: "'Segoe UI', sans-serif",
  editor: "'Segoe UI', sans-serif",
  mono: "Consolas, monospace",
}

function safeFontFamily(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback
  const trimmed = value.trim()
  return trimmed && trimmed.length <= 120 && !/[;{}]/.test(trimmed) ? trimmed : fallback
}

function clamp(value: unknown, min: number, max: number, fallback: number): number {
  const numeric = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numeric)) return fallback
  return Math.min(max, Math.max(min, Math.round(numeric)))
}

/** 旧版默认正文字号：仅持久化加载边界做一次性迁移，实时缩放路径不受影响 */
const LEGACY_BODY_FONT_SIZE = 14

export function normalizeReadingPreferences(value: Partial<ReadingPreferences> | undefined): ReadingPreferences {
  return {
    uiFontFamily: safeFontFamily(value?.uiFontFamily, DEFAULT_READING_PREFERENCES.uiFontFamily),
    editorFontFamily: safeFontFamily(value?.editorFontFamily, DEFAULT_READING_PREFERENCES.editorFontFamily),
    monoFontFamily: safeFontFamily(value?.monoFontFamily, DEFAULT_READING_PREFERENCES.monoFontFamily),
    bodyFontSize: clamp(
      value?.bodyFontSize,
      READING_BODY_FONT_SIZE_MIN,
      READING_BODY_FONT_SIZE_MAX,
      DEFAULT_READING_PREFERENCES.bodyFontSize,
    ),
    codeFontSize: clamp(
      value?.codeFontSize,
      READING_CODE_FONT_SIZE_MIN,
      READING_CODE_FONT_SIZE_MAX,
      DEFAULT_READING_PREFERENCES.codeFontSize,
    ),
  }
}

/** 加载持久化旧值时迁移一次：旧默认 14 → 新默认 16，避免缩放百分比显示 88%；用户已主动缩放的值不动 */
export function migrateLegacyReadingPreferences(value: ReadingPreferences): ReadingPreferences {
  if (DEFAULT_READING_PREFERENCES.bodyFontSize === LEGACY_BODY_FONT_SIZE) return value
  if (value.bodyFontSize !== LEGACY_BODY_FONT_SIZE) return value
  return { ...value, bodyFontSize: DEFAULT_READING_PREFERENCES.bodyFontSize }
}

export function applyReadingPreferences(preferences: ReadingPreferences): void {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  root.style.setProperty('--font-ui', `${preferences.uiFontFamily}, ${FONT_FALLBACKS.ui}`)
  root.style.setProperty('--font-editor', `${preferences.editorFontFamily}, ${FONT_FALLBACKS.editor}`)
  root.style.setProperty('--font-mono', `${preferences.monoFontFamily}, ${FONT_FALLBACKS.mono}`)
  root.style.setProperty('--font-code-size', `${preferences.codeFontSize}px`)
}

interface SettingsState {
  theme: Theme
  providers: Provider[]
  activeProvider: string | null
  isConfigured: boolean
  readingPreferences: ReadingPreferences
  providerModelOptions: Record<string, string[]>
  sessionPersistenceEnabled: boolean
  sessionRetentionDays: number
  sessionMaxStorageMb: number
  setTheme: (theme: Theme) => void
  toggleTheme: () => void
  setProviders: (providers: Provider[]) => void
  setActiveProvider: (id: string | null) => void
  setConfigured: (configured: boolean) => void
  setReadingPreferences: (preferences: Partial<ReadingPreferences>) => void
  setProviderModelOptions: (options: Record<string, string[]>) => void
  setSessionPersistence: (value: Partial<Pick<SettingsState, 'sessionPersistenceEnabled' | 'sessionRetentionDays' | 'sessionMaxStorageMb'>>) => void
}

export const useSettingsStore = create<SettingsState>((set) => ({
  theme: getInitialTheme(),
  providers: [],
  activeProvider: null,
  isConfigured: false,
  readingPreferences: DEFAULT_READING_PREFERENCES,
  providerModelOptions: {},
  sessionPersistenceEnabled: false,
  sessionRetentionDays: 30,
  sessionMaxStorageMb: 200,
  setTheme: (theme) => set({ theme }),
  toggleTheme: () => set((state) => ({ theme: state.theme === 'dark' ? 'light' : 'dark' })),
  setProviders: (providers) => set({ providers }),
  setActiveProvider: (id) => set({ activeProvider: id }),
  setConfigured: (configured) => set({ isConfigured: configured }),
  setReadingPreferences: (preferences) => set((state) => {
    const next = normalizeReadingPreferences({ ...state.readingPreferences, ...preferences })
    applyReadingPreferences(next)
    return { readingPreferences: next }
  }),
  setProviderModelOptions: (providerModelOptions) => set({ providerModelOptions }),
  setSessionPersistence: (value) => set(value),
}))

if (typeof window !== 'undefined') {
  void window.electronAPI?.settings?.get?.().then((response) => {
    if (response?.success && response.data?.readingPreferences) {
      const loaded = response.data.readingPreferences as ReadingPreferences
      useSettingsStore.getState().setReadingPreferences(migrateLegacyReadingPreferences(loaded))
      useSettingsStore.getState().setSessionPersistence({
        sessionPersistenceEnabled: response.data.sessionPersistenceEnabled === true,
        sessionRetentionDays: Number(response.data.sessionRetentionDays) || 30,
        sessionMaxStorageMb: Number(response.data.sessionMaxStorageMb) || 200,
      })
      useSettingsStore.getState().setProviderModelOptions((response.data.providerModelOptions ?? {}) as Record<string, string[]>)
    } else {
      applyReadingPreferences(DEFAULT_READING_PREFERENCES)
    }
  }).catch(() => applyReadingPreferences(DEFAULT_READING_PREFERENCES))
}
