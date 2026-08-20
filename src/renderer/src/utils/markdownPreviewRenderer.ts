import DOMPurify from 'dompurify'
import hljs from 'highlight.js'
import MarkdownIt from 'markdown-it'
import markdownItFootnote from 'markdown-it-footnote'
import markdownItTaskLists from 'markdown-it-task-lists'
import { registerMarkdownHeadingIds } from './markdownHeadingIds'
import { registerMarkdownLocalAssets } from './markdownLocalAssets'

const md = new MarkdownIt({ html: true, linkify: true, typographer: true, breaks: true })
  .use(markdownItFootnote)
  .use(markdownItTaskLists, { enabled: false, label: false })

md.linkify.set({ fuzzyLink: false })

const defaultValidateLink = md.validateLink.bind(md)
md.validateLink = (url: string) => {
  if (/^(file|flux-local):\/\//i.test(url)) return true
  return defaultValidateLink(url)
}

const escapeHtml = md.utils.escapeHtml.bind(md.utils)

/** mermaid 代码块：渲染为占位容器，由 MdPreview 异步加载 SVG（mermaid 需要 DOM） */
export const MERMAID_CLASS = 'mermaid-block'

let mermaidCounter = 0

md.set({
  highlight: (str: string, lang: string) => {
    // ```mermaid / ```flowchart 以及 ```flowchart TB 等带方向参数的语言标注都渲染为图
    const firstToken = (lang || '').trim().split(/\s+/)[0]?.toLowerCase()
    if (firstToken === 'mermaid' || firstToken === 'flowchart') {
      const id = `mermaid-${++mermaidCounter}`
      // data-mermaid-source 保留原始源码：渲染为 SVG 后 code 内容被替换，主题切换时可据此重渲染
      return `<pre class="${MERMAID_CLASS}" data-mermaid-id="${id}" data-mermaid-source="${escapeHtml(str)}"><code class="mermaid" id="${id}">${escapeHtml(str)}</code></pre>`
    }
    if (lang && hljs.getLanguage(lang)) {
      try {
        return `<pre><code class="hljs language-${lang}">${hljs.highlight(str, { language: lang, ignoreIllegals: true }).value}</code></pre>`
      } catch {
        // Unknown or malformed language input falls back to escaped code.
      }
    }
    return `<pre><code class="hljs">${escapeHtml(str)}</code></pre>`
  },
})

registerMarkdownHeadingIds(md)
registerMarkdownLocalAssets(md)

const safeMarkdownUrl = /^(?:(?:https?|mailto|file|flux-local):|data:image\/(?:png|gif|jpe?g|webp);|[#/.?]|[^a-z]|[a-z+.-]+(?:[^a-z+.-:]|$))/i

/**
 * 预处理两个列表↔引用的解析问题（跳过代码块围栏）：
 * 1. 列表项内容仅为引用（`7. > 引用` / `- > 引用`）→ 转为独立引用块
 * 2. 列表行后紧跟引用行 → 补空行，避免被解析为列表 continuation
 */
function separateBlockquoteAfterList(markdown: string): string {
  const lines = markdown.split('\n')
  const out: string[] = []
  let inFence = false
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const fence = line.match(/^\s*(```+|~~~+)/)
    if (fence) inFence = !inFence
    if (!inFence) {
      // 仅转换零缩进顶层列表项内容为引用（`7. > 内容` → `> 内容`）；
      // 缩进的行可能是嵌套列表或缩进代码块，保持原样
      const inlineQuote = line.match(/^(?:[-*+]|\d+\.)[ \t]+>[ \t]?(.*)$/)
      if (inlineQuote) {
        out.push(`> ${inlineQuote[1]}`)
        continue
      }
      if (i > 0) {
        const prev = out[out.length - 1]
        const isList = /^[ \t]*(?:[-*+]|\d+\.)[ \t]+/.test(prev)
        const isQuote = /^[ \t]*>[ \t]?/.test(line)
        if (isList && isQuote) out.push('')
      }
    }
    out.push(line)
  }
  return out.join('\n')
}

function extractFrontMatter(markdown: string): { markdown: string; frontMatter: string | null } {
  // UTF-8 BOM 开头时先剥离，避免 ^--- 匹配失败
  const stripped = markdown.charCodeAt(0) === 0xfeff ? markdown.slice(1) : markdown
  const match = stripped.match(/^---[ \t]*\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/)
  if (!match) return { markdown, frontMatter: null }

  return {
    markdown: match[0].replace(/[^\r\n]/g, ' ') + stripped.slice(match[0].length),
    frontMatter: match[1].trimEnd(),
  }
}

/**
 * Typora 式元数据卡：frontmatter 以 key: value 逐行淡化的卡片展示
 * （对应 Typora 的 pre.md-meta-block），编辑面与预览面观感一致。
 */
function frontMatterHtml(frontMatter: string): string {
  const rows = frontMatter
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .map((line) => `<span>${escapeHtml(line) || '&nbsp;'}</span>`)
    .join('\n')
  return `<pre class="markdown-frontmatter-meta-block">${rows}</pre>\n`
}

export function renderMarkdownForPreview(content: string, baseFilePath?: string | null): string {
  const extracted = extractFrontMatter(content)
  const env: Record<string, unknown> = {}
  if (baseFilePath) {
    env.baseFilePath = baseFilePath
    env.toLocalMediaUrl = (path: string) => window.electronAPI.media.toLocalUrl(path)
  }

  const sourceMarkdown = separateBlockquoteAfterList(extracted.markdown)
  const headerHtml = extracted.frontMatter ? frontMatterHtml(extracted.frontMatter) : ''
  const rendered = (headerHtml + md.render(sourceMarkdown, env))
    .replace(/\sstyle="text-align:\s*(left|center|right)"/gi, ' class="markdown-align-$1"')

  return DOMPurify.sanitize(rendered, {
    ALLOWED_URI_REGEXP: safeMarkdownUrl,
    FORBID_ATTR: ['style'],
    // mermaid 占位符需要 data-mermaid-id / data-mermaid-source 供异步渲染读取
    ALLOW_DATA_ATTR: true,
  })
}
