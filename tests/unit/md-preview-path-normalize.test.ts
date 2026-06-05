import { describe, it, expect } from 'vitest'

function normalizeWindowsAbsoluteImageLinks(markdown: string): string {
  if (!markdown || !markdown.includes('![')) return markdown

  return markdown.replace(
    /!\[([^\]]*)\]\(([A-Za-z]:\\[^)]+)\)/g,
    (_full, alt: string, winPathRaw: string) => {
      const normalizedPath = winPathRaw.replace(/\\/g, '/')
      const encodedPath = normalizedPath
        .split('/')
        .map((seg: string, idx: number) => {
          if (idx === 0 && /^[A-Za-z]:$/.test(seg)) return seg
          return encodeURIComponent(seg)
        })
        .join('/')
      return `![${alt}](file:///${encodedPath})`
    },
  )
}

describe('md-preview windows image path normalize', () => {
  it('normalizes absolute windows image path to file:// URL', () => {
    const input = '![1111](F:\\Dev\\Vibe Coding\\LogAnalyze\\test-data\\assets\\1111.png)'
    const out = normalizeWindowsAbsoluteImageLinks(input)
    expect(out).toBe(
      '![1111](file:///F:/Dev/Vibe%20Coding/LogAnalyze/test-data/assets/1111.png)',
    )
  })

  it('keeps markdown unchanged when no windows absolute image path', () => {
    const input = '![a](./assets/a.png)'
    expect(normalizeWindowsAbsoluteImageLinks(input)).toBe(input)
  })
})
