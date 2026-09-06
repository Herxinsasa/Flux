import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { MdPreview } from '../../src/renderer/src/components/editor/MdPreview'
import { renderMarkdownForPreview } from '../../src/renderer/src/utils/markdownPreviewRenderer'

// mermaid 需要浏览器 DOM，vitest node 环境无法加载真实包；这里 mock 渲染返回占位 SVG
vi.mock('mermaid', () => ({
  default: {
    initialize: vi.fn(),
    render: vi.fn(async (id: string) => ({ svg: `<svg id="${id}"><text>mock-diagram</text></svg>` })),
  },
}))

const openExternal = vi.fn()

describe('Markdown preview compatibility', () => {
  beforeEach(() => {
    openExternal.mockReset()
    Object.defineProperty(window, 'electronAPI', {
      configurable: true,
      value: {
        media: { toLocalUrl: (path: string) => `flux-local://asset/${encodeURIComponent(path)}` },
        shell: { openExternal },
      },
    })
  })

  it('preserves blockquotes nested in ordered and unordered list items', () => {
    const html = renderMarkdownForPreview(`7. > 引用内容

- > 无序引用

- 普通列表项
`)
    const document = new DOMParser().parseFromString(html, 'text/html')
    // CommonMark 语义：列表项内的引用保持嵌套关系，不能提升为独立引用块。
    expect(document.querySelectorAll('blockquote')).toHaveLength(2)
    expect(document.querySelector('ol > li > blockquote')?.textContent?.trim()).toBe('引用内容')
    expect(document.querySelector('ul > li > blockquote')?.textContent?.trim()).toBe('无序引用')
    const unorderedItems = document.querySelectorAll('ul > li')
    expect(unorderedItems[unorderedItems.length - 1]?.textContent?.trim()).toBe('普通列表项')
  })

  it('preserves nested quotes and quote-like text in code blocks', () => {
    const html = renderMarkdownForPreview(`- 父列表
  - > 嵌套引用

\`\`\`md
7. > 围栏内字面量
\`\`\`

    - > 缩进代码块行
`)
    const document = new DOMParser().parseFromString(html, 'text/html')
    // 嵌套列表内的引用保持嵌套关系（在 li 内）。
    const nested = document.querySelector('ul li ul li blockquote')
    expect(nested?.textContent?.trim()).toBe('嵌套引用')
    // 围栏内字面量保持为代码内容。
    const fenced = document.querySelector('pre code.language-md')
    expect(fenced?.textContent).toContain('7. > 围栏内字面量')
    // 缩进代码块行保持为代码内容。
    const indented = document.querySelectorAll('pre code')[1]
    expect(indented?.textContent).toContain('- > 缩进代码块行')
  })

  it('renders the CommonMark and GFM structures used by daily documents', () => {
    const html = renderMarkdownForPreview(`
# H1
## H2
### H3
#### H4
##### H5
###### H6

Plain **strong** *emphasis* ~~deleted~~ and [link](https://example.com).

- nested
  1. ordered
- [ ] open task
- [x] completed task

> quoted text

| Left | Right |
| :--- | ---: |
| A | B |

Inline \`code\`.

\`\`\`ts
const ready = true
\`\`\`

---
`)

    const document = new DOMParser().parseFromString(html, 'text/html')
    expect(document.querySelectorAll('h1,h2,h3,h4,h5,h6')).toHaveLength(6)
    expect(document.querySelector('strong')?.textContent).toBe('strong')
    expect(document.querySelector('em')?.textContent).toBe('emphasis')
    expect(document.querySelector('s')?.textContent).toBe('deleted')
    expect(document.querySelector('ol')).not.toBeNull()
    expect(document.querySelectorAll('.task-list-item-checkbox')).toHaveLength(2)
    expect(document.querySelector<HTMLInputElement>('.task-list-item-checkbox:checked')).not.toBeNull()
    expect(document.querySelector('blockquote')?.textContent).toContain('quoted text')
    expect(document.querySelectorAll('table th')).toHaveLength(2)
    expect(document.querySelector('table th.markdown-align-left')).not.toBeNull()
    expect(document.querySelector('table th.markdown-align-right')).not.toBeNull()
    expect(document.querySelector('code:not(pre code)')?.textContent).toBe('code')
    expect(document.querySelector('pre code.language-ts')?.textContent).toContain('const ready')
    expect(document.querySelector('hr')).not.toBeNull()
  })

  it('renders front matter and footnotes without corrupting source-line heading ids', () => {
    const html = renderMarkdownForPreview(`---
title: Daily note
tags: [flux, markdown]
---
# Document

Statement with a note.[^daily]

[^daily]: Footnote content.
`)

    const document = new DOMParser().parseFromString(html, 'text/html')
    // frontmatter 渲染为 Typora 式元数据卡（key:value 逐行淡化，不再展开为大标题）
    const metaBlock = document.querySelector('.markdown-frontmatter-meta-block')
    expect(metaBlock?.textContent).toContain('title: Daily note')
    expect(metaBlock?.textContent).toContain('tags: [flux, markdown]')
    // 正文标题仍保留源码行号 id
    const bodyHeading = [...document.querySelectorAll('h1')].find((h) => h.textContent === 'Document')
    expect(bodyHeading?.id).toBe('md-line-5')
    expect(document.querySelector('.footnote-ref')).not.toBeNull()
    expect(document.querySelector('.footnotes')?.textContent).toContain('Footnote content')
  })

  it('renders SKILL.md-style frontmatter as a Typora-style meta block with escaped content', () => {
    const html = renderMarkdownForPreview(`---
name: spec-analyzer
description: 需求澄清与规格整理 <工具>
tags: [guide]
---
# 正文
`)

    const document = new DOMParser().parseFromString(html, 'text/html')
    const metaBlock = document.querySelector('.markdown-frontmatter-meta-block')
    expect(metaBlock?.textContent).toContain('name: spec-analyzer')
    // 内容转义：<工具> 不得成为 HTML 标签
    expect(metaBlock?.querySelector('工具')).toBeNull()
    expect(metaBlock?.textContent).toContain('description: 需求澄清与规格整理 <工具>')
    expect(metaBlock?.textContent).toContain('tags: [guide]')
    // 正文标题不受影响
    expect([...document.querySelectorAll('h1')].find((h) => h.textContent === '正文')).not.toBeNull()
  })

  it('renders any frontmatter content as the meta block without expanding title fields', () => {
    const html = renderMarkdownForPreview(`---
title: 正式标题
name: 内部名
description: 摘要
---
正文
`)
    const document = new DOMParser().parseFromString(html, 'text/html')
    // 不再展开 title 为大标题/引用块；全部字段原样进入元数据卡
    expect(document.querySelector('.markdown-frontmatter-title')).toBeNull()
    const metaBlock = document.querySelector('.markdown-frontmatter-meta-block')
    expect(metaBlock?.textContent).toContain('title: 正式标题')
    expect(metaBlock?.textContent).toContain('name: 内部名')
    expect(metaBlock?.textContent).toContain('description: 摘要')
    // frontmatter 不再产生正文外的 h1；正文段落保持
    expect(document.querySelectorAll('h1')).toHaveLength(0)
    expect([...document.querySelectorAll('p')].map((p) => p.textContent)).toContain('正文')

    const odd = renderMarkdownForPreview(`---
无法解析的内容
---
正文
`)
    const oddDoc = new DOMParser().parseFromString(odd, 'text/html')
    expect(oddDoc.querySelector('.markdown-frontmatter-meta-block')?.textContent).toContain('无法解析的内容')
  })

  it('adds readable and unique aliases for standard in-document heading links', () => {
    const html = renderMarkdownForPreview(`# 安装步骤

[跳转到安装步骤](#安装步骤)

## Install **Flux**

## Install Flux
`)

    const document = new DOMParser().parseFromString(html, 'text/html')
    expect(document.querySelector('.markdown-heading-anchor#安装步骤')).not.toBeNull()
    expect(document.querySelector('.markdown-heading-anchor#install-flux')).not.toBeNull()
    expect(document.querySelector('.markdown-heading-anchor#install-flux-1')).not.toBeNull()
    const jumpLink = [...document.querySelectorAll('a')]
      .find((anchor) => anchor.textContent === '跳转到安装步骤')
    expect(decodeURIComponent(jumpLink?.getAttribute('href') ?? '')).toBe('#安装步骤')
  })

  it('keeps useful raw HTML while removing executable content', () => {
    const html = renderMarkdownForPreview(`
<details open><summary>More</summary><kbd>Ctrl</kbd> + <kbd>S</kbd></details>

<img src="https://example.com/x.png" style="position:fixed" onerror="window.hacked=true">
<a href="javascript:alert(1)" onclick="window.hacked=true">unsafe</a>
<script>window.hacked=true</script>
`)

    const document = new DOMParser().parseFromString(html, 'text/html')
    expect(document.querySelector('details[open] summary')?.textContent).toBe('More')
    expect(document.querySelectorAll('kbd')).toHaveLength(2)
    expect(document.querySelector('img')?.hasAttribute('onerror')).toBe(false)
    expect(document.querySelector('img')?.hasAttribute('style')).toBe(false)
    expect(document.querySelector('a')?.hasAttribute('onclick')).toBe(false)
    expect(document.querySelector('a')?.hasAttribute('href')).toBe(false)
    expect(document.querySelector('script')).toBeNull()
  })

  it('opens external links through Electron even outside a file-backed preview', () => {
    render(<MdPreview content="[Flux](https://example.com/docs)" hideEmptyPlaceholder />)

    fireEvent.click(screen.getByRole('link', { name: 'Flux' }))

    expect(openExternal).toHaveBeenCalledWith('https://example.com/docs')
  })
})
