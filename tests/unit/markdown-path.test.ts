import { describe, it, expect } from 'vitest'
import {
  resolvePathFromBase,
  isExternalUrl,
  isMarkdownFilePath,
} from '../../src/shared/markdown-path'

describe('markdown-path', () => {
  it('detects external urls', () => {
    expect(isExternalUrl('https://a.com/x.png')).toBe(true)
    expect(isExternalUrl('./local.png')).toBe(false)
  })

  it('resolves relative image against base file directory', () => {
    const base = 'F:\\docs\\readme.md'
    expect(resolvePathFromBase(base, './assets/demo.png')).toBe('F:\\docs\\assets\\demo.png')
    expect(resolvePathFromBase(base, '../img/a.png')).toBe('F:\\img\\a.png')
  })

  it('resolves relative md link', () => {
    const base = '/workspace/guide/intro.md'
    expect(resolvePathFromBase(base, '../other/page.md')).toBe('/workspace/other/page.md')
    expect(isMarkdownFilePath('../other/page.md')).toBe(true)
  })

  it('ignores anchors and external links', () => {
    expect(resolvePathFromBase('/a/b.md', '#section')).toBe(null)
    expect(resolvePathFromBase('/a/b.md', 'https://x.com')).toBe(null)
  })
})
