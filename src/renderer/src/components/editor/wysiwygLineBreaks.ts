import { remarkStringifyOptionsCtx } from '@milkdown/kit/core'
import type { Ctx } from '@milkdown/kit/ctx'

/** Use trailing spaces for hard breaks so other Markdown editors do not expose a backslash marker. */
export function serializeMarkdownHardBreak(): string {
  return '  \n'
}

export function hasTrailingMarkdownHardBreak(markdown: string): boolean {
  return /(?: {2,}|\\)\r?\n$/.test(markdown)
}

/** Milkdown drops a hard break when it is the final inline node; retain its portable Markdown form. */
export function preserveTrailingMarkdownHardBreak(
  markdown: string,
  documentEndsWithHardBreak: boolean,
): string {
  if (!documentEndsWithHardBreak || hasTrailingMarkdownHardBreak(markdown)) return markdown
  if (markdown.endsWith('\n')) return `${markdown.slice(0, -1)}  \n`
  return `${markdown}  \n`
}

/**
 * remark-gfm escapes every literal tilde even when single-tilde strikethrough is disabled.
 * Remove only the syntactic escape; keep literal backslashes and fenced-code protection intact.
 */
export function normalizeWysiwygMarkdown(markdown: string): string {
  return markdown.replace(/\\+~/g, (match, offset: number) => {
    const slashCount = match.length - 1
    if (slashCount % 2 === 0) return match
    if (markdown.slice(offset + match.length, offset + match.length + 2) === '~~') return match
    return `${'\\'.repeat(slashCount - 1)}~`
  })
}

export function registerWysiwygLineBreakStringify(ctx: Ctx): void {
  const original = ctx.get(remarkStringifyOptionsCtx)
  ctx.update(remarkStringifyOptionsCtx, () => ({
    ...original,
    handlers: {
      ...(original.handlers as Record<string, unknown>),
      break: serializeMarkdownHardBreak,
    },
  }))
}
