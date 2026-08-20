import type { Node as ProseMirrorNode } from '@milkdown/prose/model'

export interface WysiwygTextRange {
  from: number
  to: number
}

function stripInlineMarkdown(text: string): string {
  return text
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/[\\*_~`]/g, '')
}

function stripBlockMarkdown(text: string): string {
  return text
    .split(/\r?\n/)
    .map((line) => line
      .replace(/^\s{0,3}>\s?/, '')
      .replace(/^\s*(?:[-*+]|\d+\.)\s+/, '')
      .replace(/^\s{0,3}#{1,6}\s+/, ''))
    .join('\n')
}

function normalizeReviewQuote(text: string): string {
  return stripInlineMarkdown(stripBlockMarkdown(text)).replace(/\r\n/g, '\n')
}

function collectPlainText(doc: ProseMirrorNode): { text: string; map: number[] } {
  let text = ''
  const map: number[] = []
  doc.descendants((node, position) => {
    if (!node.isText || !node.text) return true
    for (let index = 0; index < node.text.length; index += 1) {
      text += node.text[index]
      map.push(position + index)
    }
    return true
  })
  return { text, map }
}

function collectExactNodeRanges(doc: ProseMirrorNode, quote: string): WysiwygTextRange[] {
  const found: WysiwygTextRange[] = []
  doc.descendants((node, position) => {
    if (!node.isText || !node.text) return true
    let searchFrom = 0
    while (searchFrom <= node.text.length - quote.length) {
      const index = node.text.indexOf(quote, searchFrom)
      if (index < 0) break
      found.push({ from: position + index, to: position + index + quote.length })
      searchFrom = index + Math.max(1, quote.length)
    }
    return true
  })
  return found
}

function collectFlatRanges(text: string, map: number[], quote: string): WysiwygTextRange[] {
  const found: WysiwygTextRange[] = []
  let searchFrom = 0
  while (searchFrom <= text.length - quote.length) {
    const index = text.indexOf(quote, searchFrom)
    if (index < 0) break
    const from = map[index]
    const last = map[index + quote.length - 1]
    if (from != null && last != null) found.push({ from, to: last + 1 })
    searchFrom = index + Math.max(1, quote.length)
  }
  return found
}

function pickNearestRange(
  ranges: WysiwygTextRange[],
  docSize: number,
  preferredRatio?: number,
): WysiwygTextRange | null {
  if (ranges.length === 0) return null
  if (preferredRatio == null || !Number.isFinite(preferredRatio)) return ranges[0]
  const preferredPosition = Math.max(0, Math.min(1, preferredRatio)) * docSize
  return ranges.reduce((nearest, candidate) =>
    Math.abs(candidate.from - preferredPosition) < Math.abs(nearest.from - preferredPosition)
      ? candidate
      : nearest,
  )
}

export function findTextRangeInProseMirror(
  doc: ProseMirrorNode,
  quote: string,
  preferredRatio?: number,
): WysiwygTextRange | null {
  const rawQuote = quote.replace(/\r\n/g, '\n')
  if (!rawQuote.trim()) return null

  const exact = collectExactNodeRanges(doc, rawQuote)
  if (exact.length > 0) return pickNearestRange(exact, doc.content.size, preferredRatio)

  const normalizedQuote = normalizeReviewQuote(rawQuote)
  if (!normalizedQuote.trim()) return null

  const plain = collectPlainText(doc)
  return pickNearestRange(
    collectFlatRanges(plain.text, plain.map, normalizedQuote),
    doc.content.size,
    preferredRatio,
  )
}
