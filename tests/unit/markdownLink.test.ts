import { describe, expect, it } from 'vitest'
import {
  findMarkdownImageAt,
  findMarkdownLinkAt,
  formatMarkdownLink,
} from '../../src/renderer/src/components/editor/markdownLink'

describe('formatMarkdownLink', () => {
  it('writes a standard inline link', () => {
    expect(formatMarkdownLink('链接文本', 'https://example.com')).toBe(
      '[链接文本](https://example.com)',
    )
  })

  it('escapes brackets in the display text', () => {
    expect(formatMarkdownLink('a]b', './x.md')).toBe('[a\\]b](./x.md)')
  })

  it('wraps hrefs containing whitespace or parentheses in angle brackets', () => {
    expect(formatMarkdownLink('带空格', 'a b.md')).toBe('[带空格](<a b.md>)')
    expect(formatMarkdownLink('括号', 'a(b).md')).toBe('[括号](<a(b).md>)')
  })
})

describe('findMarkdownLinkAt', () => {
  it('finds the link containing a collapsed cursor', () => {
    const content = '前 [链接文本](https://example.com) 后'
    const cursor = content.indexOf('链接文本') + 1
    expect(findMarkdownLinkAt(content, cursor, cursor)).toEqual({
      from: 2,
      to: 2 + '[链接文本](https://example.com)'.length,
      text: '链接文本',
      href: 'https://example.com',
    })
  })

  it('finds a link intersecting a selection and unescapes brackets', () => {
    const content = 'a [x\\]y](./doc.md) b'
    const found = findMarkdownLinkAt(content, 3, 6)
    expect(found?.text).toBe('x]y')
    expect(found?.href).toBe('./doc.md')
  })

  it('unwraps angle-bracket hrefs', () => {
    const found = findMarkdownLinkAt('[文档](<a b.md>)', 2, 2)
    expect(found?.href).toBe('a b.md')
  })

  it('round-trips angle-bracket hrefs containing parentheses', () => {
    const content = formatMarkdownLink('括号', 'a(b).md')
    expect(content).toBe('[括号](<a(b).md>)')
    expect(findMarkdownLinkAt(content, 2, 2)).toEqual({
      from: 0,
      to: content.length,
      text: '括号',
      href: 'a(b).md',
    })
  })

  it('marks links whose text contains an image as non-editable', () => {
    const content = '一 [![图](a.png)](b.md) 二'
    const expected = {
      from: 2,
      to: 2 + '[![图](a.png)](b.md)'.length,
      text: '![图](a.png)',
      href: 'b.md',
      editable: false,
    }
    const inAlt = content.indexOf('图')
    const inHref = content.indexOf('b.md')
    expect(findMarkdownLinkAt(content, inAlt, inAlt)).toEqual(expected)
    expect(findMarkdownLinkAt(content, inHref, inHref)).toEqual(expected)
  })

  it('ignores image syntax', () => {
    expect(findMarkdownLinkAt('![图](a.png)', 2, 2)).toBeNull()
  })

  it('finds the image syntax containing the cursor', () => {
    const content = '前 ![图](a.png) 后'
    const cursor = content.indexOf('图')
    expect(findMarkdownImageAt(content, cursor, cursor)).toEqual({
      from: 2,
      to: 2 + '![图](a.png)'.length,
    })
    expect(findMarkdownImageAt(content, 0, 0)).toBeNull()
  })

  it('returns null when the cursor is outside every link', () => {
    expect(findMarkdownLinkAt('a [x](y) b', 0, 0)).toBeNull()
  })
})
