import fs from 'fs'
import path from 'path'
import Store from 'electron-store'
import log from '../logger'
import { getConfigDir } from '../paths'
import { migrateStoreSchema, STORE_DEFAULTS, type StoreSchema } from './schema'

const STORE_OPTIONS = {
  cwd: getConfigDir(),
  name: 'flux-settings',
  /** 明文 JSON，便于直接打开 flux-settings.json 查看（密钥后期再考虑加密方案）。 */
  defaults: STORE_DEFAULTS,
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
migrateStoreSchema(store)

log.info(`[store] settings file: ${store.path}`)

export default store
