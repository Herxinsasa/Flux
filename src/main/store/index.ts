import fs from 'fs'
import path from 'path'
import Store from 'electron-store'
import log from '../logger'
import { getConfigDir } from '../paths'

interface ProviderConfig {
  id: string
  name: string
  type: 'anthropic' | 'anthropic_compat' | 'openai_compat'
  apiKey: string
  baseUrl?: string
  model: string
}

interface StoreSchema {
  theme: 'dark' | 'light'
  providers: ProviderConfig[]
  activeProvider: string | null
  configured: boolean
  windowBounds: { width: number; height: number }
}

const STORE_OPTIONS = {
  cwd: getConfigDir(),
  name: 'flux-settings',
  /** 明文 JSON，便于直接打开 flux-settings.json 查看（密钥后期再考虑加密方案）。 */
  defaults: {
    theme: 'dark' as const,
    providers: [] as ProviderConfig[],
    activeProvider: null,
    configured: false,
    windowBounds: { width: 1440, height: 900 },
  },
}

function createSettingsStore(): Store<StoreSchema> {
  try {
    return new Store<StoreSchema>(STORE_OPTIONS)
  } catch (err) {
    log.error(`[store] failed to open settings store: ${String(err)}`)
    const storePath = path.join(STORE_OPTIONS.cwd, `${STORE_OPTIONS.name}.json`)
    if (fs.existsSync(storePath)) {
      const bak = `${storePath}.corrupt.${Date.now()}`
      try {
        fs.renameSync(storePath, bak)
        log.warn(`[store] renamed unreadable store to ${bak} and recreating defaults`)
      } catch (renameErr) {
        log.error(`[store] could not backup corrupt file: ${String(renameErr)}`)
        throw err
      }
    }
    return new Store<StoreSchema>(STORE_OPTIONS)
  }
}

const store = createSettingsStore()

log.info(`[store] settings file: ${store.path}`)

export default store
