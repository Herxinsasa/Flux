import { describe, expect, it } from 'vitest'
import { mergeRecentItems } from '../../src/shared/recent'

describe('mergeRecentItems', () => {
  it('deduplicates Windows paths case-insensitively and moves the item to the front', () => {
    const items = [{ path: 'C:\\Notes\\Today.md', kind: 'file' as const, openedAt: 1 }]
    const result = mergeRecentItems(items, { path: 'c:\\notes\\today.md', kind: 'file', openedAt: 2 }, true)
    expect(result).toEqual([{ path: 'c:\\notes\\today.md', kind: 'file', openedAt: 2 }])
  })

  it('keeps at most ten entries', () => {
    const items = Array.from({ length: 10 }, (_, index) => ({ path: `/file-${index}.txt`, kind: 'file' as const, openedAt: index }))
    expect(mergeRecentItems(items, { path: '/new.txt', kind: 'file', openedAt: 11 }, false)).toHaveLength(10)
  })
})
