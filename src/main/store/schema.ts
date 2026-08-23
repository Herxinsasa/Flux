export interface ProviderConfig {
  id: string
  name: string
  type: 'anthropic' | 'anthropic_compat' | 'openai_compat'
  apiKey: string
  baseUrl?: string
  model: string
}

export interface RecentItem {
  path: string
  kind: 'file' | 'folder'
  openedAt: number
}

export interface ReadingPreferences {
  uiFontFamily: string
  editorFontFamily: string
  monoFontFamily: string
  bodyFontSize: number
  codeFontSize: number
}

export interface StoreSchema {
  schemaVersion: 2
  theme: 'dark' | 'light'
  providers: ProviderConfig[]
  activeProvider: string | null
  configured: boolean
  windowBounds: { width: number; height: number }
  recentItems: RecentItem[]
  onboardingCompleted: boolean
  readingPreferences: ReadingPreferences
  providerModelOptions: Record<string, string[]>
  sessionPersistenceEnabled: boolean
  sessionRetentionDays: number
  sessionMaxStorageMb: number
}

export const STORE_DEFAULTS: StoreSchema = {
  schemaVersion: 2,
  theme: 'dark',
  providers: [],
  activeProvider: null,
  configured: false,
  windowBounds: { width: 1440, height: 900 },
  recentItems: [],
  onboardingCompleted: false,
  readingPreferences: {
    uiFontFamily: 'Microsoft YaHei',
    editorFontFamily: 'Microsoft YaHei',
    monoFontFamily: 'Consolas',
    bodyFontSize: 14,
    codeFontSize: 13,
  },
  providerModelOptions: {},
  sessionPersistenceEnabled: false,
  sessionRetentionDays: 30,
  sessionMaxStorageMb: 200,
}

function normalizeFontFamily(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback
  const trimmed = value.trim()
  return trimmed && trimmed.length <= 120 && !/[;{}]/.test(trimmed) ? trimmed : fallback
}

function normalizeFontSize(value: unknown, min: number, max: number, fallback: number): number {
  const numeric = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numeric)) return fallback
  return Math.min(max, Math.max(min, Math.round(numeric)))
}

export function normalizeReadingPreferences(value: Partial<ReadingPreferences> | undefined): ReadingPreferences {
  const defaults = STORE_DEFAULTS.readingPreferences
  return {
    uiFontFamily: normalizeFontFamily(value?.uiFontFamily, defaults.uiFontFamily),
    editorFontFamily: normalizeFontFamily(value?.editorFontFamily, defaults.editorFontFamily),
    monoFontFamily: normalizeFontFamily(value?.monoFontFamily, defaults.monoFontFamily),
    bodyFontSize: normalizeFontSize(value?.bodyFontSize, 8, 40, defaults.bodyFontSize),
    codeFontSize: normalizeFontSize(value?.codeFontSize, 6, 36, defaults.codeFontSize),
  }
}

interface MigratableStore {
  has(key: string): boolean
  set(key: string, value: unknown): void
}

/** Additive V1-to-V2 migration; existing values are never overwritten. */
export function migrateStoreSchema(store: MigratableStore): void {
  for (const [key, value] of Object.entries(STORE_DEFAULTS)) {
    if (!store.has(key)) {
      store.set(key, structuredClone(value))
    }
  }
  store.set('schemaVersion', 2)
}
