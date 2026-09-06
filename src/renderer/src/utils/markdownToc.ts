import type MarkdownIt from 'markdown-it'
import type Token from 'markdown-it/lib/token.mjs'

import { headingIdForSourceLine, plainHeadingText } from './markdownHeadingIds'

const TOC_MARKER_PATTERN = /^[ \t]*\[toc\][ \t]*$/i

export interface MarkdownTocHeading {
  id: string
  level: number
  text: string
}

interface MarkdownTocTokenMeta {
  headings: MarkdownTocHeading[]
}

function inlineTokenText(token: Token | undefined): string {
  if (!token) return ''
  const text = token.children
    ?.map((child) => {
      if (child.type === 'text' || child.type === 'code_inline' || child.type === 'image') {
        return child.content
      }
      return ''
    })
    .join('')
  return plainHeadingText(text || token.content)
}

function collectHeadingTokens(tokens: Token[]): MarkdownTocHeading[] {
  const headings: MarkdownTocHeading[] = []
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]
    if (token.type !== 'heading_open' || token.map == null) continue
    const level = Number(token.tag.slice(1))
    const text = inlineTokenText(tokens[index + 1])
    if (level < 1 || level > 6 || !text) continue
    headings.push({
      id: headingIdForSourceLine(token.map[0] + 1),
      level,
      text,
    })
  }
  return headings
}

function replaceStandaloneTocParagraphs(tokens: Token[], headings: MarkdownTocHeading[]): void {
  for (let index = 0; index <= tokens.length - 3; index += 1) {
    const paragraphOpen = tokens[index]
    const inline = tokens[index + 1]
    const paragraphClose = tokens[index + 2]
    const isStandaloneLine = inline.map != null && inline.map[1] - inline.map[0] === 1
    const isTopLevelParagraph = paragraphOpen.type === 'paragraph_open' && paragraphOpen.level === 0
    if (
      !isTopLevelParagraph ||
      inline.type !== 'inline' ||
      paragraphClose.type !== 'paragraph_close' ||
      !isStandaloneLine ||
      !TOC_MARKER_PATTERN.test(inline.content)
    ) {
      continue
    }

    const tocToken = new paragraphOpen.constructor('flux_toc', 'nav', 0)
    tocToken.block = true
    tocToken.map = paragraphOpen.map
    tocToken.meta = { headings } satisfies MarkdownTocTokenMeta
    tokens.splice(index, 3, tocToken)
  }
}

/** Register the standalone `[TOC]` extension without changing heading ID generation. */
export function registerMarkdownToc(md: MarkdownIt): void {
  md.core.ruler.after('inline', 'flux_toc', (state) => {
    const headings = collectHeadingTokens(state.tokens)
    replaceStandaloneTocParagraphs(state.tokens, headings)
  })

  md.renderer.rules.flux_toc = (tokens, index) => {
    const meta = tokens[index].meta as MarkdownTocTokenMeta | null
    const items = (meta?.headings ?? [])
      .map(
        (heading) =>
          `<li class="markdown-toc-level-${heading.level}">` +
          `<a href="#${heading.id}">${md.utils.escapeHtml(heading.text)}</a>` +
          '</li>',
      )
      .join('')
    return `<nav class="markdown-toc" aria-label="目录"><ol>${items}</ol></nav>\n`
  }
}
