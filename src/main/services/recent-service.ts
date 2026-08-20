import fs from 'fs'
import path from 'path'
import store from '../store'
import type { RecentItem } from '../store/schema'
import type { RecentItemData } from '../../shared/recent'
import { mergeRecentItems } from '../../shared/recent'

export function listRecentItems(): RecentItemData[] {
  return store.get('recentItems').map((item) => ({ ...item, exists: fs.existsSync(item.path) }))
}

export function recordRecentItem(itemPath: string, kind: RecentItem['kind']): void {
  const normalizedPath = path.resolve(itemPath)
  const next = mergeRecentItems(store.get('recentItems'), { path: normalizedPath, kind, openedAt: Date.now() }, process.platform === 'win32') as RecentItem[]
  store.set('recentItems', next)
}

export function removeRecentItem(itemPath: string): void {
  const key = process.platform === 'win32' ? itemPath.toLocaleLowerCase() : itemPath
  store.set('recentItems', store.get('recentItems').filter((item) => (process.platform === 'win32' ? item.path.toLocaleLowerCase() : item.path) !== key))
}
