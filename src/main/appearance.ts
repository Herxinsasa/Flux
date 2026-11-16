import store from './store'
import { AppearanceService } from './services/appearance-service'
import type { StoreSchema } from './store/schema'

export const appearance = new AppearanceService({
  get: (key) => store.get(key as keyof StoreSchema),
  set: (values) => {
    store.store = { ...store.store, ...values } as StoreSchema
  },
})
