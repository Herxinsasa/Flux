export interface MarkdownLinkRange {
  from: number
  to: number
  text: string
  href: string
  /** 链接文本包含图片等不可安全往返的语法；调用方应跳过编辑。 */
  editable?: boolean
}

export interface MarkdownImageRange {
  from: number
  to: number
}

interface InlineConstruct {
  kind: 'link' | 'image'
  from: number
  to: number
  text: string
  href: string
}

interface ParsedDestination {
  href: string
  end: number
}

function isEscaped(content: string, index: number): boolean {
  let backslashes = 0
  for (let i = index - 1; i >= 0 && content[i] === '\\'; i--) backslashes++
  return backslashes % 2 === 1
}

function escapeLinkText(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/\[/g, '\\[').replace(/\]/g, '\\]')
}

function unescapeLinkText(text: string): string {
  return text.replace(/\\([\\[\]])/g, '$1')
}

function normalizeHref(href: string): string {
  const trimmed = href.trim()
  if (!trimmed) return ''
  if (trimmed.startsWith('<') && trimmed.endsWith('>')) return trimmed
  return /[\s()]/.test(trimmed) ? `<${trimmed}>` : trimmed
}

function decodeHref(raw: string): string {
  return raw.trim().replace(/\\([()])/g, '$1')
}

/** 生成可直接写入 Markdown 的行内链接文本。 */
export function formatMarkdownLink(text: string, href: string): string {
  return `[${escapeLinkText(text.trim())}](${normalizeHref(href)})`
}

function findClosingBracket(content: string, open: number): number {
  let depth = 0
  for (let i = open; i < content.length; i++) {
    const char = content[i]
    if (char === '\\') {
      i++
      continue
    }
    if (char === '[') {
      depth++
    } else if (char === ']') {
      depth--
      if (depth === 0) return i
    }
  }
  return -1
}

function parseDestination(content: string, openParen: number): ParsedDestination | null {
  let i = openParen + 1
  while (i < content.length && /\s/.test(content[i])) i++
  if (i >= content.length) return null

  if (content[i] === '<') {
    const start = i + 1
    i++
    while (i < content.length) {
      const char = content[i]
      if (char === '\\') {
        i += 2
        continue
      }
      if (char === '\n') return null
      if (char === '>') break
      i++
    }
    if (i >= content.length || content[i] !== '>') return null
    const href = content.slice(start, i)
    i++
    while (i < content.length && /\s/.test(content[i])) i++
    if (content[i] !== ')') return null
    return { href: decodeHref(href), end: i + 1 }
  }

  const start = i
  let depth = 0
  while (i < content.length) {
    const char = content[i]
    if (char === '\\') {
      i += 2
      continue
    }
    if (char === '\n') return null
    if (char === '(') {
      depth++
    } else if (char === ')') {
      if (depth === 0) {
        return { href: decodeHref(content.slice(start, i)), end: i + 1 }
      }
      depth--
    }
    i++
  }
  return null
}

function containsImageSyntax(text: string): boolean {
  for (let i = 0; i < text.length - 1; i++) {
    if (text[i] === '\\') {
      i++
      continue
    }
    if (text[i] === '!' && text[i + 1] === '[') return true
  }
  return false
}

/**
 * 扫描行内链接与图片。尖括号地址 `<...>` 作为整体解析，地址内的括号不会再截断。
 * 链接文本中的图片保持为一个整体，由调用方决定是否允许编辑。
 */
function scanInlineConstructs(content: string): InlineConstruct[] {
  const constructs: InlineConstruct[] = []
  for (let i = 0; i < content.length; i++) {
    if (content[i] === '\\') {
      i++
      continue
    }
    if (content[i] !== '[') continue

    const isImage = i > 0 && content[i - 1] === '!' && !isEscaped(content, i - 1)
    const close = findClosingBracket(content, i)
    if (close < 0 || content[close + 1] !== '(') continue
    const destination = parseDestination(content, close + 1)
    if (!destination) continue

    constructs.push({
      kind: isImage ? 'image' : 'link',
      from: isImage ? i - 1 : i,
      to: destination.end,
      text: content.slice(i + 1, close),
      href: destination.href,
    })
    i = destination.end - 1
  }
  return constructs
}

function intersects(from: number, to: number, start: number, end: number): boolean {
  return start === end ? start >= from && start < to : start < to && end > from
}

/**
 * 查找与当前选区/光标相交的行内链接。
 * 光标位于链接语法内部（含起点）时返回整段链接，便于对话框预填并整体替换。
 * 链接文本包含图片时返回 `editable: false`，调用方不得整体替换。
 */
export function findMarkdownLinkAt(
  content: string,
  from: number,
  to: number,
): MarkdownLinkRange | null {
  const start = Math.min(from, to)
  const end = Math.max(from, to)
  for (const construct of scanInlineConstructs(content)) {
    if (construct.kind !== 'link') continue
    if (!intersects(construct.from, construct.to, start, end)) continue
    const range: MarkdownLinkRange = {
      from: construct.from,
      to: construct.to,
      text: unescapeLinkText(construct.text),
      href: construct.href,
    }
    if (containsImageSyntax(construct.text)) range.editable = false
    return range
  }
  return null
}

/** 查找与当前选区/光标相交的 Markdown 图片语法，用于阻止在图片内部插入链接。 */
export function findMarkdownImageAt(
  content: string,
  from: number,
  to: number,
): MarkdownImageRange | null {
  const start = Math.min(from, to)
  const end = Math.max(from, to)
  for (const construct of scanInlineConstructs(content)) {
    if (construct.kind !== 'image') continue
    if (!intersects(construct.from, construct.to, start, end)) continue
    return { from: construct.from, to: construct.to }
  }
  return null
}
