import type MarkdownIt from 'markdown-it'

export interface MdOutlineItem {
  line: number
  level: number
  text: string
  /** 与预览 DOM id 一致（按源码行号，避免与 token 文本不一致） */
  id: string
}

export function headingIdForSourceLine(line: number): string {
  return `md-line-${line}`
}

/** 从 Markdown 源码解析大纲（行号从 1 起） */
export function parseMarkdownOutline(content: string): MdOutlineItem[] {
  const lines = content.split(/\r?\n/)
  const out: MdOutlineItem[] = []

  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(#{1,6})\s+(.+?)\s*$/)
    if (!m) continue
    const level = m[1].length
    const text = m[2].trim().replace(/[#*`]+$/, '').trim()
    const line = i + 1
    out.push({ line, level, text, id: headingIdForSourceLine(line) })
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

/** 为 markdown-it 标题注入与源码行一致的 id */
export function registerMarkdownHeadingIds(md: MarkdownIt): void {
  const orig = md.renderer.rules.heading_open
  md.renderer.rules.heading_open = (tokens, idx, options, env, self) => {
    const t = tokens[idx]
    const line = t.map != null ? t.map[0] + 1 : 0
    if (line > 0) {
      t.attrSet('id', headingIdForSourceLine(line))
    }
    return orig ? orig(tokens, idx, options, env, self) : self.renderToken(tokens, idx, options)
  }
}
