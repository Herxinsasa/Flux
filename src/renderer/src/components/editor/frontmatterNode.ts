import { $node } from '@milkdown/utils'
import { remarkPluginsCtx, remarkStringifyOptionsCtx } from '@milkdown/core'
import type { Ctx } from '@milkdown/ctx'
import remarkFrontmatter from 'remark-frontmatter'

/**
 * YAML frontmatter 节点：Milkdown 默认把开头的 `---` 解析为 hr、
 * `name: x` + 闭合 `---` 解析为 setext 标题（显示为 *** 与长下划线）。
 * 此节点接入 remark-frontmatter（解析）与 remark-stringify handlers（序列化），
 * 使编辑面把 frontmatter 当作独立可编辑区块渲染。
 */
export const frontmatterNode = $node('yaml', () => ({
  group: 'block',
  content: 'text*',
  marks: '',
  defining: true,
  parseDOM: [{ tag: 'div.flux-frontmatter-block', preserveWhitespace: 'full' }],
  toDOM: () => ['div', { class: 'flux-frontmatter-block', 'data-language': 'yaml' }, 0],
  parseMarkdown: {
    match: ({ type }) => type === 'yaml',
    runner: (state, node, type) => {
      const value = typeof node.value === 'string' ? node.value : ''
      state.openNode(type)
      if (value) state.addText(value)
      state.closeNode()
    },
  },
  toMarkdown: {
    match: (node) => node.type.name === 'yaml',
    runner: (state, node) => {
      state.addNode('yaml', undefined, node.textContent)
    },
  },
}))

/** remark 管线注入 remark-frontmatter：把开头的 YAML 区块解析为 mdast yaml 节点 */
export function registerFrontmatterParsing(ctx: Ctx): void {
  ctx.update(remarkPluginsCtx, (prev) => [...prev, { plugin: remarkFrontmatter, options: undefined }])
}

/** remark-stringify 增加 yaml 节点编译：输出 `---\n{value}\n---`，保证编辑面回写不丢 frontmatter */
export function registerFrontmatterStringify(ctx: Ctx): void {
  const original = ctx.get(remarkStringifyOptionsCtx)
  ctx.update(remarkStringifyOptionsCtx, () => ({
    ...original,
    handlers: {
      ...(original.handlers as Record<string, unknown>),
      yaml: (node: { value?: string }) => `---\n${node.value ?? ''}\n---`,
    },
  }))
}
