import { remarkStringifyOptionsCtx } from '@milkdown/kit/core'
import type { Ctx } from '@milkdown/kit/ctx'

/** Use trailing spaces for hard breaks so other Markdown editors do not expose a backslash marker. */
export function serializeMarkdownHardBreak(): string {
  return '  \n'
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
