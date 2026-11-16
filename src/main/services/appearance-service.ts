import type { AppearanceSnapshot, AppearanceUpdate, ReadingPreferences } from '../../shared/types'
import { normalizeReadingPreferences } from '../store/schema'

interface AppearanceStore {
  get(key: string): unknown
  set(values: Record<string, unknown>): void
}

const MIGRATION_KEY = 'codeFontMigrationVersion'
const FONT_MIGRATION_VERSION = 1

export class AppearanceValidationError extends Error {}

export class AppearanceService {
  private revision = 0
  private legacyBodyMapping: boolean | null = null
  private readonly listeners = new Set<(snapshot: AppearanceSnapshot) => void>()

  constructor(private readonly store: AppearanceStore) {}

  snapshot(): AppearanceSnapshot {
    this.migrate()
    return this.current()
  }

  current(): AppearanceSnapshot {
    const preferences = normalizeReadingPreferences(
      this.store.get('readingPreferences') as Partial<ReadingPreferences>,
    )
    if (this.legacyBodyMapping === null) this.legacyBodyMapping = preferences.bodyFontSize === 14
    return {
      revision: this.revision,
      theme: this.store.get('theme') === 'light' ? 'light' : 'dark',
      readingPreferences: this.legacyBodyMapping
        ? { ...preferences, bodyFontSize: 16 }
        : preferences,
    }
  }

  subscribe(listener: (snapshot: AppearanceSnapshot) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  update(update: AppearanceUpdate): AppearanceSnapshot {
    this.validate(update)
    const previous = this.snapshot()
    const persisted = this.store.get('readingPreferences')
    const persistedPreferences = persisted && typeof persisted === 'object' ? persisted : {}
    const mergedPreferences = { ...persistedPreferences, ...update.readingPreferences }
    const next = {
      theme: update.theme ?? previous.theme,
      readingPreferences: normalizeReadingPreferences(mergedPreferences),
    }
    const changes: Record<string, unknown> = {}
    if (update.theme !== undefined) changes.theme = update.theme
    if (update.readingPreferences !== undefined) changes.readingPreferences = mergedPreferences
    if (Object.keys(changes).length > 0) this.store.set(changes)
    if (update.readingPreferences?.bodyFontSize !== undefined) this.legacyBodyMapping = false
    this.revision++
    const snapshot = {
      revision: this.revision,
      theme: next.theme,
      readingPreferences: this.legacyBodyMapping
        ? { ...next.readingPreferences, bodyFontSize: 16 }
        : next.readingPreferences,
    }
    for (const listener of this.listeners) listener(snapshot)
    return snapshot
  }

  private migrate(): void {
    const version = this.store.get(MIGRATION_KEY)
    if (typeof version === 'number' && version >= FONT_MIGRATION_VERSION) return
    const current = this.store.get('readingPreferences')
    const preferences = current && typeof current === 'object' ? current : {}
    this.store.set({
      readingPreferences: { ...preferences, monoFontFamily: 'Cascadia Mono' },
      [MIGRATION_KEY]: FONT_MIGRATION_VERSION,
    })
  }

  private validate(update: AppearanceUpdate): void {
    if (!update || typeof update !== 'object' || Array.isArray(update))
      throw new AppearanceValidationError('Invalid appearance update')
    if (Object.keys(update).some((key) => key !== 'theme' && key !== 'readingPreferences'))
      throw new AppearanceValidationError('Invalid appearance field')
    if (update.theme !== undefined && update.theme !== 'dark' && update.theme !== 'light')
      throw new AppearanceValidationError('Invalid theme')
    if (update.readingPreferences === undefined) return
    const preferences = update.readingPreferences
    if (!preferences || typeof preferences !== 'object' || Array.isArray(preferences))
      throw new AppearanceValidationError('Invalid reading preferences')
    for (const [key, value] of Object.entries(preferences)) {
      if (['uiFontFamily', 'editorFontFamily', 'monoFontFamily'].includes(key)) {
        if (
          typeof value !== 'string' ||
          !value.trim() ||
          value.trim().length > 120 ||
          /[;{}]/.test(value)
        )
          throw new AppearanceValidationError('Invalid font family')
      } else if (key === 'bodyFontSize' || key === 'codeFontSize') {
        const min = key === 'bodyFontSize' ? 8 : 6
        const max = key === 'bodyFontSize' ? 40 : 36
        if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max)
          throw new AppearanceValidationError('Invalid font size')
      } else {
        throw new AppearanceValidationError('Invalid reading preference')
      }
    }
  }
}
