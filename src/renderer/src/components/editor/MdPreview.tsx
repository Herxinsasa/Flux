import { useMemo, useRef, useLayoutEffect, useCallback } from 'react'
import MarkdownIt from 'markdown-it'
import hljs from 'highlight.js'
import { registerMarkdownHeadingIds } from '../../utils/markdownHeadingIds'
import { registerMarkdownLocalAssets } from '../../utils/markdownLocalAssets'
import {
  isExternalUrl,
  isMarkdownFilePath,
  resolvePathFromBase,
  hrefPathPart,
} from '../../../../shared/markdown-path'
import { useFileStore } from '../../stores/fileStore'

const md = new MarkdownIt({ html: true, linkify: true, typographer: true, breaks: true })
md.linkify.set({
  fuzzyLink: false,
})
const defaultValidateLink = md.validateLink.bind(md)
md.validateLink = (url: string) => {
  if (/^(file|flux-local):\/\//i.test(url)) return true
  return defaultValidateLink(url)
}
const escapeHtml = md.utils.escapeHtml.bind(md.utils)

md.set({
  highlight: (str: string, lang: string) => {
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
registerMarkdownLocalAssets(md)

interface MdPreviewProps {
  content: string
  /** 当前 Markdown 文件绝对路径，用于解析相对图片与 .md 链接 */
  baseFilePath?: string | null
  scrollToHeadingId?: string | null
  scrollRequestKey?: number
  hideEmptyPlaceholder?: boolean
  scrollable?: boolean
}

/**
 * 兼容 Windows 绝对路径图片写法：![x](F:\\a\\b\\c.png)
 * 统一转成 file:///F:/a/b/c.png，避免 markdown-it 将反斜杠视为转义导致图片失效。
 */
function normalizeWindowsAbsoluteImageLinks(markdown: string): string {
  if (!markdown || !markdown.includes('![')) return markdown

  return markdown.replace(
    /!\[([^\]]*)\]\(([A-Za-z]:\\[^)]+)\)/g,
    (_full, alt: string, winPathRaw: string) => {
      const normalizedPath = winPathRaw.replace(/\\/g, '/')
      const encodedPath = normalizedPath
        .split('/')
        .map((seg: string, idx: number) => {
          // 盘符段保持如 F:
          if (idx === 0 && /^[A-Za-z]:$/.test(seg)) return seg
          return encodeURIComponent(seg)
        })
        .join('/')
      return `![${alt}](file:///${encodedPath})`
    },
  )
}

function scrollElementIntoView(container: HTMLElement, target: Element) {
  const scrollParent =
    (target.closest('.markdown-preview.flux-scroll') as HTMLElement | null) ??
    (target.closest('.markdown-split-right') as HTMLElement | null) ??
    (target.closest('.markdown-zoom-layer') as HTMLElement | null)

  if (scrollParent && scrollParent !== target) {
    const parentRect = scrollParent.getBoundingClientRect()
    const targetRect = target.getBoundingClientRect()
    const offset =
      targetRect.top - parentRect.top - parentRect.height / 2 + targetRect.height / 2
    scrollParent.scrollTo({
      top: scrollParent.scrollTop + offset,
      behavior: 'smooth',
    })
    return
  }

  target.scrollIntoView({ behavior: 'smooth', block: 'center' })
}

export function MdPreview({
  content,
  baseFilePath,
  scrollToHeadingId,
  scrollRequestKey,
  hideEmptyPlaceholder,
  scrollable = true,
}: MdPreviewProps) {
  const wrapRef = useRef<HTMLDivElement>(null)

  const html = useMemo(() => {
    if (!content) return ''
    const normalized = normalizeWindowsAbsoluteImageLinks(content)
    const env: Record<string, unknown> = {}
    if (baseFilePath) {
      env.baseFilePath = baseFilePath
      env.toLocalMediaUrl = (p: string) => window.electronAPI.media.toLocalUrl(p)
    }
    return md.render(normalized, env)
  }, [content, baseFilePath])

  useLayoutEffect(() => {
    if (!scrollToHeadingId || !wrapRef.current) return
    const el = wrapRef.current.querySelector(`#${CSS.escape(scrollToHeadingId)}`)
    if (el) scrollElementIntoView(wrapRef.current, el)
  }, [scrollRequestKey, scrollToHeadingId, html])

  const handlePreviewClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      const anchor = (event.target as HTMLElement | null)?.closest('a')
      if (!anchor || !baseFilePath) return

      const href = anchor.getAttribute('href')?.trim()
      if (!href) return

      if (href.startsWith('#')) {
        event.preventDefault()
        const id = decodeURIComponent(href.slice(1))
        const el = wrapRef.current?.querySelector(`#${CSS.escape(id)}`)
        if (el && wrapRef.current) scrollElementIntoView(wrapRef.current, el)
        return
      }

      if (isExternalUrl(href)) {
        event.preventDefault()
        void window.electronAPI.shell.openExternal(href)
        return
      }

      const resolved = resolvePathFromBase(baseFilePath, href)
      if (resolved && isMarkdownFilePath(hrefPathPart(href))) {
        event.preventDefault()
        void useFileStore.getState().openLinkedMarkdown(resolved, baseFilePath)
      }
    },
    [baseFilePath],
  )

  if (!content.trim() && hideEmptyPlaceholder) {
    return null
  }

  return (
    <div
      ref={wrapRef}
      className="markdown-preview-container"
      style={scrollable ? { height: '100%', overflow: 'hidden' } : { height: 'auto', overflow: 'visible' }}
      onClick={baseFilePath ? handlePreviewClick : undefined}
    >
      {content ? (
        <div
          className={scrollable ? 'markdown-preview flux-scroll' : 'markdown-preview markdown-preview--static'}
          dangerouslySetInnerHTML={{ __html: html }}
        />
      ) : hideEmptyPlaceholder ? null : (
        <div className="markdown-preview markdown-preview-empty">
          <span className="markdown-preview-empty-text">输入 Markdown 内容即可实时预览</span>
        </div>
      )}
    </div>
  )
}
