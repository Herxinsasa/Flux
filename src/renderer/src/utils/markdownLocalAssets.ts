import type MarkdownIt from 'markdown-it'
import { isExternalUrl, resolvePathFromBase } from '../../../shared/markdown-path'

export interface MarkdownRenderEnv {
  baseFilePath?: string
  toLocalMediaUrl?: (absolutePath: string) => string
}

function shouldRewriteImageSrc(src: string): boolean {
  const s = src.trim()
  if (!s) return false
  if (isExternalUrl(s)) return false
  // 内联或浏览器对象 URL 不应改写为本地文件协议。
  if (/^(data:|blob:|cid:|javascript:)/i.test(s)) return false
  return true
}

function rewriteHtmlImgSources(html: string, env: MarkdownRenderEnv): string {
  if (!env.baseFilePath || !env.toLocalMediaUrl || !html.includes('<img')) return html

  return html.replace(/<img\b[^>]*\bsrc\s*=\s*("([^"]*)"|'([^']*)')/gi, (full, attr, dq, sq) => {
    const src = (dq ?? sq ?? '').trim()
    if (!shouldRewriteImageSrc(src)) return full
    const abs = resolvePathFromBase(env.baseFilePath!, src)
    if (!abs) return full
    const local = env.toLocalMediaUrl!(abs)
    const quote = attr.startsWith('"') ? '"' : "'"
    return full.replace(attr, `${quote}${local}${quote}`)
  })
}

export function registerMarkdownLocalAssets(md: MarkdownIt): void {
  const defaultImage =
    md.renderer.rules.image ??
    ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options))

  md.renderer.rules.image = (tokens, idx, options, env, self) => {
    const token = tokens[idx]
    const src = token.attrGet('src') ?? ''
    const renderEnv = env as MarkdownRenderEnv
    if (renderEnv.baseFilePath && shouldRewriteImageSrc(src)) {
      const abs = resolvePathFromBase(renderEnv.baseFilePath, src)
      if (abs && renderEnv.toLocalMediaUrl) {
        token.attrSet('src', renderEnv.toLocalMediaUrl(abs))
      }
    }
    return defaultImage(tokens, idx, options, env, self)
  }

  const defaultHtmlInline =
    md.renderer.rules.html_inline ??
    ((tokens, idx) => tokens[idx]?.content ?? '')

  md.renderer.rules.html_inline = (tokens, idx, options, env, self) => {
    const raw = defaultHtmlInline(tokens, idx, options, env, self)
    return rewriteHtmlImgSources(raw, env as MarkdownRenderEnv)
  }

  const defaultHtmlBlock =
    md.renderer.rules.html_block ??
    ((tokens, idx) => tokens[idx]?.content ?? '')

  md.renderer.rules.html_block = (tokens, idx, options, env, self) => {
    const raw = defaultHtmlBlock(tokens, idx, options, env, self)
    return rewriteHtmlImgSources(raw, env as MarkdownRenderEnv)
  }
}
