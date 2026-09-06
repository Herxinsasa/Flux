import { describe, expect, it } from 'vitest'

import { renderMarkdownForPreview } from '../../src/renderer/src/utils/markdownPreviewRenderer'

function parsePreview(markdown: string): Document {
  return new DOMParser().parseFromString(renderMarkdownForPreview(markdown), 'text/html')
}

describe('Markdown CommonMark and GFM regression baseline', () => {
  it('keeps a single tilde literal and renders only double tildes as strikethrough', () => {
    const document = parsePreview('single: ~保留~\n\ndouble: ~~删除~~')

    expect(document.body.textContent).toContain('single: ~保留~')
    expect(document.querySelectorAll('s')).toHaveLength(1)
    expect(document.querySelector('s')?.textContent).toBe('删除')
  })

  it('keeps a CommonMark soft line break inside one paragraph without inserting br', () => {
    const document = parsePreview('第一行\n第二行')
    const paragraph = document.querySelector('p')

    expect(paragraph).not.toBeNull()
    expect(paragraph?.querySelector('br')).toBeNull()
    expect(paragraph?.textContent).toContain('第一行')
    expect(paragraph?.textContent).toContain('第二行')
  })

  it('renders two trailing spaces as a CommonMark hard line break', () => {
    const document = parsePreview('第一行  \n第二行')
    const paragraph = document.querySelector('p')

    expect(paragraph?.querySelectorAll('br')).toHaveLength(1)
    expect(paragraph?.textContent).toContain('第一行')
    expect(paragraph?.textContent).toContain('第二行')
  })

  it('preserves a blockquote nested in a list item', () => {
    const document = parsePreview('- > 列表内引用')
    const listItem = document.querySelector('ul > li')

    expect(listItem).not.toBeNull()
    expect(listItem?.querySelector('blockquote')?.textContent?.trim()).toBe('列表内引用')
    expect(document.body.firstElementChild?.tagName).toBe('UL')
  })
})
