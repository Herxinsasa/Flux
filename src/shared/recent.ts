export interface RecentItemData {
  path: string
  kind: 'file' | 'folder'
  openedAt: number
  exists: boolean
}

export interface RecentItemRecord {
  path: string
  kind: 'file' | 'folder'
  openedAt: number
}

export function mergeRecentItems(items: RecentItemRecord[], next: RecentItemRecord, caseInsensitive: boolean): RecentItemRecord[] {
  const key = (itemPath: string) => caseInsensitive ? itemPath.toLocaleLowerCase() : itemPath
  return [next, ...items.filter((item) => key(item.path) !== key(next.path))].slice(0, 10)
}
