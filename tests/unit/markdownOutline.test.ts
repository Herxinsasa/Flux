import { describe, expect, it } from 'vitest'
import { parseMarkdownOutline } from '../../src/renderer/src/utils/markdownHeadingIds'

describe('Markdown outline', () => {
  it('tracks duplicate headings in document order', () => {
    const outline = parseMarkdownOutline('# 重复\n\n## 子项\n\n# 重复')
    expect(outline.map(({ level, text, occurrence }) => ({ level, text, occurrence }))).toEqual([
      { level: 1, text: '重复', occurrence: 0 },
      { level: 2, text: '子项', occurrence: 0 },
      { level: 1, text: '重复', occurrence: 1 },
    ])
  })

  it('normalizes formatted and Setext headings for WYSIWYG lookup', () => {
    const outline = parseMarkdownOutline('## **粗体**与[链接](./a.md)\n\n一级标题\n===')
    expect(outline.map(({ level, text }) => ({ level, text }))).toEqual([
      { level: 2, text: '粗体与链接' },
      { level: 1, text: '一级标题' },
    ])
  })
})

describe('Markdown outline frontmatter', () => {
  it('skips YAML frontmatter instead of treating it as setext headings', () => {
    const outline = parseMarkdownOutline('---\ntitle: My Doc\ntags: [a, b]\n---\n\n# 真实标题\n\n## 二级\n===')
    const items = outline.map(({ level, text }) => ({ level, text }))
    // frontmatter 的 tags 行 + 闭合 --- 不再构成幻影 setext 条目；## 二级 是 ATX 二级
    expect(items).toEqual([
      { level: 1, text: '真实标题' },
      { level: 2, text: '二级' },
    ])
  })

  it('keeps source line numbers stable when frontmatter is skipped', () => {
    const outline = parseMarkdownOutline('---\nname: x\n---\n# A\n\n## B')
    expect(outline.map(({ line, text }) => ({ line, text }))).toEqual([
      { line: 4, text: 'A' },
      { line: 6, text: 'B' },
    ])
  })
})
