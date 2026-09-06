import DOMPurify from 'dompurify'
import hljs from 'highlight.js'
import MarkdownIt from 'markdown-it'
import markdownItFootnote from 'markdown-it-footnote'
import markdownItTaskLists from 'markdown-it-task-lists'
import { isPlainTextCodeLanguage, normalizeCodeBlockLanguage } from './codeBlockLanguage'
import { registerMarkdownHeadingIds } from './markdownHeadingIds'
import { registerMarkdownLocalAssets } from './markdownLocalAssets'
import { registerMarkdownToc } from './markdownToc'

const md = new MarkdownIt({ html: true, linkify: true, typographer: true, breaks: false })
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
    const firstToken = normalizeCodeBlockLanguage(lang)
    if (firstToken === 'mermaid' || firstToken === 'flowchart') {
      const id = `mermaid-${++mermaidCounter}`
      // data-mermaid-source 保留原始源码：渲染为 SVG 后 code 内容被替换，主题切换时可据此重渲染
      return `<pre class="${MERMAID_CLASS}" data-mermaid-id="${id}" data-mermaid-source="${escapeHtml(str)}"><code class="mermaid" id="${id}">${escapeHtml(str)}</code></pre>`
    }
    if (firstToken && !isPlainTextCodeLanguage(firstToken) && hljs.getLanguage(firstToken)) {
      try {
        return `<pre><code class="hljs language-${firstToken}">${hljs.highlight(str, { language: firstToken, ignoreIllegals: true }).value}</code></pre>`
      } catch {
        // Unknown or malformed language input falls back to escaped code.
      }
    }
    const languageClass = firstToken ? ` language-${firstToken}` : ''
    return `<pre><code class="hljs${languageClass}">${escapeHtml(str)}</code></pre>`
  },
})

registerMarkdownHeadingIds(md)
registerMarkdownLocalAssets(md)
registerMarkdownToc(md)

const safeMarkdownUrl =
  /^(?:(?:https?|mailto|file|flux-local):|data:image\/(?:png|gif|jpe?g|webp);|[#/.?]|[^a-z]|[a-z+.-]+(?:[^a-z+.-:]|$))/i

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

  const headerHtml = extracted.frontMatter ? frontMatterHtml(extracted.frontMatter) : ''
  const rendered = (headerHtml + md.render(extracted.markdown, env)).replace(
    /\sstyle="text-align:\s*(left|center|right)"/gi,
    ' class="markdown-align-$1"',
  )

  return DOMPurify.sanitize(rendered, {
    ALLOWED_URI_REGEXP: safeMarkdownUrl,
    FORBID_ATTR: ['style'],
    // mermaid 占位符需要 data-mermaid-id / data-mermaid-source 供异步渲染读取
    ALLOW_DATA_ATTR: true,
  })
}
