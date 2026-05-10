import { useMemo, useRef, useLayoutEffect } from 'react'
import MarkdownIt from 'markdown-it'
import hljs from 'highlight.js'
import { registerMarkdownHeadingIds } from '../../utils/markdownHeadingIds'

// Building the MarkdownIt instance must be two-step to avoid a circular
// reference: the highlight callback references the instance.
const md = new MarkdownIt({ html: true, linkify: true, typographer: true, breaks: true })
// Disable fuzzy domain matching to avoid converting plain filenames like README.md into links.
md.linkify.set({
  fuzzyLink: false,
})
const escapeHtml = md.utils.escapeHtml.bind(md.utils)

md.set({ highlight: (str: string, lang: string) => {
    if (lang && hljs.getLanguage(lang)) {
      try {
        return `<pre><code class="hljs language-${lang}">${hljs.highlight(str, { language: lang, ignoreIllegals: true }).value}</code></pre>`
      } catch {
        // fall through to escape
      }
    }
    return `<pre><code class="hljs">${escapeHtml(str)}</code></pre>`
  },
})

registerMarkdownHeadingIds(md)

interface MdPreviewProps {
  content: string
  /** 大纲点击后滚动到对应标题（与 heading id 一致） */
  scrollToHeadingId?: string | null
  /** 同一标题重复对齐时用于强制重新触发滚动 */
  scrollRequestKey?: number
  /** 无内容时不显示编辑器占位文案（用于对话气泡等） */
  hideEmptyPlaceholder?: boolean
  /** 由外层容器统一接管滚动，避免嵌套滚动条 */
  scrollable?: boolean
}

export function MdPreview({ content, scrollToHeadingId, scrollRequestKey, hideEmptyPlaceholder, scrollable = true }: MdPreviewProps) {
  const wrapRef = useRef<HTMLDivElement>(null)

  const html = useMemo(() => {
    if (!content) return ''
    return md.render(content)
  }, [content])

  useLayoutEffect(() => {
    if (!scrollToHeadingId || !wrapRef.current) return
    const el = wrapRef.current.querySelector(`#${CSS.escape(scrollToHeadingId)}`)
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [scrollRequestKey, scrollToHeadingId, html])

  if (!content.trim() && hideEmptyPlaceholder) {
    return null
  }

  return (
    <div
      ref={wrapRef}
      className="markdown-preview-container"
      style={scrollable ? { height: '100%', overflow: 'hidden' } : { height: 'auto', overflow: 'visible' }}
    >
      {content ? (
        <div
          className={scrollable ? 'markdown-preview flux-scroll' : 'markdown-preview markdown-preview--static'}
          dangerouslySetInnerHTML={{ __html: html }}
        />
      ) : hideEmptyPlaceholder ? null : (
        <div className="markdown-preview markdown-preview-empty">
          <span className="markdown-preview-empty-text">
            输入 Markdown 内容即可实时预览
          </span>
        </div>
      )}
    </div>
  )
}
