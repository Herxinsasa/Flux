import type MarkdownIt from 'markdown-it'

export interface MdOutlineItem {
  line: number
  level: number
  text: string
  occurrence: number
  /** 与预览 DOM id 一致（按源码行号，避免与 token 文本不一致） */
  id: string
}

export function headingIdForSourceLine(line: number): string {
  return `md-line-${line}`
}

/** 标题/引用文本规范化：剥离行内标记、链接、图片、转义符，供大纲文本与编辑面 doc 文本对称比较 */
export function plainHeadingText(source: string): string {
  return source
    .replace(/\s+#+\s*$/, '')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/[\\*_~`]/g, '')
    .trim()
}

/**
 * 剥离文档开头的 YAML frontmatter（首行 --- 至闭合 ---/...），内容行以空格占位保留行号，
 * 与 markdownPreviewRenderer 的 extractFrontMatter 行为一致，避免把
 * `tags: [a, b]` + 闭合 `---` 误判为 setext 大纲条目。
 */
function stripFrontMatterForOutline(lines: string[]): string[] {
  if (lines.length === 0 || !/^---[ \t]*$/.test(lines[0])) return lines
  const out = lines.slice()
  for (let i = 1; i < out.length; i++) {
    if (/^(?:---|\.\.\.)[ \t]*$/.test(out[i])) {
      out[i] = ''
      return out
    }
    out[i] = out[i].replace(/[^\r\n]/g, ' ')
  }
  return lines
}

/** 从 Markdown 源码解析大纲（行号从 1 起；跳过代码块围栏与 frontmatter） */
export function parseMarkdownOutline(content: string): MdOutlineItem[] {
  const lines = stripFrontMatterForOutline(content.split(/\r?\n/))
  const out: MdOutlineItem[] = []
  const occurrences = new Map<string, number>()
  let inFence = false

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]
    // 围栏状态机：``` 或 ~~~ 起止（含语言标注），围栏内标题不参与大纲
    const fence = raw.match(/^\s*(```+|~~~+)/)
    if (fence) {
      inFence = !inFence
      continue
    }
    if (inFence) continue

    const m = raw.match(/^(#{1,6})\s+(.+?)\s*$/)
    const setext = i + 1 < lines.length ? lines[i + 1].match(/^\s*(=+|-+)\s*$/) : null
    // setext 前置行不能是列表项/引用行（`- item\n---` 是列表+分隔线，不是标题）
    const isListOrQuote = /^[ \t]*(?:[-*+]|\d+\.)[ \t]+/.test(raw) || /^[ \t]*>/.test(raw)
    if (!m && (!setext || !raw.trim() || isListOrQuote)) continue
    const level = m ? m[1].length : setext?.[1].startsWith('=') ? 1 : 2
    const text = plainHeadingText(m ? m[2] : raw)
    if (!text) continue
    const line = i + 1
    const key = `${level}:${text}`
    const occurrence = occurrences.get(key) ?? 0
    occurrences.set(key, occurrence + 1)
    out.push({ line, level, text, occurrence, id: headingIdForSourceLine(line) })
    if (setext && !m) i += 1
  }
  return out
}

export function findNearestHeadingIdForLine(content: string, line: number): string | null {
  if (line <= 0) return null
  const outline = parseMarkdownOutline(content)
  let candidate: MdOutlineItem | null = null

  for (const item of outline) {
    if (item.line > line) break
    candidate = item
  }

  return candidate?.id ?? outline[0]?.id ?? null
}

function headingSlug(text: string): string {
  const slug = text
    .trim()
    .toLocaleLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^\p{L}\p{N}_-]/gu, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
  return slug || 'heading'
}

/** 为 markdown-it 标题注入与源码行一致的 id */
export function registerMarkdownHeadingIds(md: MarkdownIt): void {
  const orig = md.renderer.rules.heading_open
  md.renderer.rules.heading_open = (tokens, idx, options, env, self) => {
    const t = tokens[idx]
    const line = t.map != null ? t.map[0] + 1 : 0
    let alias = ''
    if (line > 0) {
      t.attrSet('id', headingIdForSourceLine(line))

      const inline = tokens[idx + 1]
      const headingText = inline?.children
        ?.filter((child) => child.type === 'text' || child.type === 'code_inline')
        .map((child) => child.content)
        .join('') ?? inline?.content ?? ''
      const baseSlug = headingSlug(headingText)
      const renderEnv = env as Record<string, unknown>
      const counts = (renderEnv.__headingSlugCounts ??= new Map<string, number>()) as Map<string, number>
      const duplicateIndex = counts.get(baseSlug) ?? 0
      counts.set(baseSlug, duplicateIndex + 1)
      const slug = duplicateIndex === 0 ? baseSlug : `${baseSlug}-${duplicateIndex}`
      alias = `<span id="${md.utils.escapeHtml(slug)}" class="markdown-heading-anchor" aria-hidden="true"></span>`
    }
    const heading = orig ? orig(tokens, idx, options, env, self) : self.renderToken(tokens, idx, options)
    return alias + heading
  }
}
