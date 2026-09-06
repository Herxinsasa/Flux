import { describe, expect, it } from 'vitest'

import { MARKDOWN_COMMAND_GROUPS } from '../../src/renderer/src/components/editor/markdownCommandModel'
import {
  createSourceMarkdownEdit,
  type MarkdownCommandId,
} from '../../src/renderer/src/components/editor/sourceMarkdownCommands'
import { renderMarkdownForPreview } from '../../src/renderer/src/utils/markdownPreviewRenderer'

describe('Markdown TOC regression baseline', () => {
  it('renders a standalone TOC marker with Chinese and duplicate heading links', () => {
    const html = renderMarkdownForPreview(`[TOC]

# 中文标题

## 重复标题

## 重复标题
`)
    const document = new DOMParser().parseFromString(html, 'text/html')
    const toc = document.querySelector('.markdown-toc')
    const links = [...(toc?.querySelectorAll<HTMLAnchorElement>('a') ?? [])]

    expect(toc).not.toBeNull()
    expect(links.map((link) => link.textContent?.trim())).toEqual([
      '中文标题',
      '重复标题',
      '重复标题',
    ])
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      '#md-line-3',
      '#md-line-5',
      '#md-line-7',
    ])
    expect(document.querySelector('h1')?.id).toBe('md-line-3')
    expect([...document.querySelectorAll('h2')].map((heading) => heading.id)).toEqual([
      'md-line-5',
      'md-line-7',
    ])
  })

  it('exposes TOC in the insert command group', () => {
    const insertGroup = MARKDOWN_COMMAND_GROUPS.find((group) => group.label === '插入')
    const tocCommand = insertGroup?.items.find((item) => String(item.id) === 'insert-toc')

    expect(tocCommand).toMatchObject({ id: 'insert-toc', label: '目录' })
  })

  it('inserts a standalone TOC marker from the source editor command', () => {
    const command = 'insert-toc' as MarkdownCommandId
    const edit = createSourceMarkdownEdit(command, '', 0, 0)

    expect(edit).toEqual({
      from: 0,
      to: 0,
      insert: '[TOC]\n\n',
      selection: { anchor: 7 },
    })
  })
})
