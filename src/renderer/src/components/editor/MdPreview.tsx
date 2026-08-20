import { useMemo, useRef, useLayoutEffect, useCallback, useEffect } from 'react'
import { renderMarkdownForPreview, MERMAID_CLASS } from '../../utils/markdownPreviewRenderer'
import {
  isExternalUrl,
  isMarkdownFilePath,
  resolvePathFromBase,
  hrefPathPart,
} from '../../../../shared/markdown-path'
import { useFileStore } from '../../stores/fileStore'
import { useSettingsStore } from '../../stores/settingsStore'

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
  const theme = useSettingsStore((s) => s.theme)

  const html = useMemo(() => {
    if (!content) return ''
    return renderMarkdownForPreview(normalizeWindowsAbsoluteImageLinks(content), baseFilePath)
  }, [content, baseFilePath])

  // 异步渲染 mermaid 图表：markdown-it 只输出占位容器（code 内保留源码），
  // 这里用 mermaid 生成 SVG 替换 code 内容；源码始终保留在 DOM，主题切换时可重渲染
  useEffect(() => {
    if (!html.includes(MERMAID_CLASS) || !wrapRef.current) return
    let cancelled = false
    void (async () => {
      const { default: mermaid } = await import('mermaid')
      const blocks = wrapRef.current!.querySelectorAll<HTMLPreElement>(`.${MERMAID_CLASS}`)
      for (let index = 0; index < blocks.length; index++) {
        if (cancelled) break
        const block = blocks[index]
        const code = block.querySelector('code')
        // 优先读 data-mermaid-source（SVG 替换后 code 文本不再是源码）
        const source = block.dataset.mermaidSource ?? code?.textContent ?? ''
        if (!source.trim()) continue
        try {
          // strict 模式会转义标签内 HTML/事件处理器，避免 mermaid 输出绕过 DOMPurify 造成 XSS
          mermaid.initialize({ startOnLoad: false, theme: theme === 'dark' ? 'dark' : 'default', securityLevel: 'strict' })
          const { svg } = await mermaid.render(`flux-mermaid-${block.dataset.mermaidId ?? index}`, source)
          if (cancelled) return
          // 仅替换 code 内部内容，保留 code 元素以便主题切换时读取源码重渲染
          code.innerHTML = svg
          code.setAttribute('data-rendered', 'true')
        } catch {
          // 渲染失败保留源码块，用户可查看原始定义
          code?.removeAttribute('class')
          code?.removeAttribute('data-rendered')
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [html, theme])

  useLayoutEffect(() => {
    if (!scrollToHeadingId || !wrapRef.current) return
    const el = wrapRef.current.querySelector(`#${CSS.escape(scrollToHeadingId)}`)
    if (el) scrollElementIntoView(wrapRef.current, el)
  }, [scrollRequestKey, scrollToHeadingId, html])

  const handlePreviewClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      const anchor = (event.target as HTMLElement | null)?.closest('a')
      if (!anchor) return

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

      if (!baseFilePath) return
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
      onClick={handlePreviewClick}
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
