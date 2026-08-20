import type { ReviewComment, ReviewExportPresentation } from './review'
import { sortReviewComments } from './review'

function effectiveComments(comments: ReviewComment[]): ReviewComment[] {
  return sortReviewComments(comments).filter((comment) =>
    comment.anchorStatus !== 'orphaned' &&
    comment.anchor.start >= 0 &&
    comment.anchor.end > comment.anchor.start &&
    comment.body.trim().length > 0,
  )
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function escapeMarkdown(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/([\\[\]*_`])/g, '\\$1')
    .replace(/\r?\n/g, '\n    ')
}

function markdownReplies(comment: ReviewComment): string[] {
  return (comment.replies ?? []).map((reply) =>
    `   - ${reply.role === 'reviewer' ? '评审人' : '修改人'}回复：${escapeMarkdown(reply.body.trim()).replace(/\n\s*\n/g, '<br><br>\n     ')}`,
  )
}

function insertMarkdownMarkers(source: string, comments: ReviewComment[], footnotes: boolean): string {
  const insertions = comments
    .map((comment, index) => ({
      offset: Math.min(source.length, comment.anchor.end),
      marker: footnotes ? `[^flux-review-${index + 1}]` : `〔批注${index + 1}〕`,
    }))
    .sort((left, right) => right.offset - left.offset)
  let output = source
  for (const insertion of insertions) {
    output = output.slice(0, insertion.offset) + insertion.marker + output.slice(insertion.offset)
  }
  return output
}

export function buildReviewMarkdown(
  sourceContent: string,
  inputComments: ReviewComment[],
  presentation: ReviewExportPresentation,
): string {
  const comments = effectiveComments(inputComments)
  if (comments.length === 0) return sourceContent
  const footnotes = presentation === 'footnotes'
  const sections = [insertMarkdownMarkers(sourceContent, comments, footnotes), '']
  if (footnotes) {
    for (let index = 0; index < comments.length; index++) {
      sections.push(`[^flux-review-${index + 1}]: ${escapeMarkdown(comments[index].body.trim())}`)
    }
    sections.push('')
  }
  sections.push('## 评审清单', '')
  comments.forEach((comment, index) => {
    const state = comment.status === 'resolved' ? '已解决' : '未解决'
    sections.push(`${index + 1}. **${state}** · ${comment.author === 'ai' ? 'AI' : '用户'}`)
    sections.push(`   - 原文：${escapeMarkdown(comment.anchor.quote)}`)
    sections.push(`   - 评审人：${escapeMarkdown(comment.body.trim())}`)
    sections.push(...markdownReplies(comment))
  })
  return sections.join('\n').replace(/\n{3,}/g, '\n\n')
}

function annotatedHtml(source: string, comments: ReviewComment[]): string {
  const points = new Set<number>([0, source.length])
  comments.forEach((comment) => {
    points.add(Math.max(0, Math.min(source.length, comment.anchor.start)))
    points.add(Math.max(0, Math.min(source.length, comment.anchor.end)))
  })
  const boundaries = [...points].sort((a, b) => a - b)
  const segments: string[] = []
  for (let index = 0; index < boundaries.length - 1; index++) {
    const start = boundaries[index]
    const end = boundaries[index + 1]
    const escaped = escapeHtml(source.slice(start, end))
    const active = comments
      .map((comment, commentIndex) => ({ comment, commentIndex }))
      .filter(({ comment }) => comment.anchor.start < end && comment.anchor.end > start)
      .map(({ commentIndex }) => commentIndex + 1)
    const anchors = comments
      .map((comment, commentIndex) => ({ comment, commentIndex }))
      .filter(({ comment }) => comment.anchor.start === start)
      .map(({ commentIndex }) => `<span id="review-source-${commentIndex + 1}"></span>`)
      .join('')
    segments.push(anchors + (active.length > 0
      ? `<mark data-comments="${active.join(',')}">${escaped}</mark>`
      : escaped))
  }
  return segments.join('')
}

export function buildReviewHtml(sourceContent: string, inputComments: ReviewComment[]): string {
  const comments = effectiveComments(inputComments)
  const items = comments.map((comment, index) => {
    const state = comment.status === 'resolved' ? '已解决' : '未解决'
    const replies = (comment.replies ?? []).map((reply) => `<div class="reply"><strong>${reply.role === 'reviewer' ? '评审人' : '修改人'}</strong><p>${escapeHtml(reply.body).replace(/\r?\n/g, '<br>')}</p></div>`).join('')
    return `<li id="review-${index + 1}"><a href="#review-source-${index + 1}">批注 ${index + 1}</a><span class="state">${state}</span><blockquote>${escapeHtml(comment.anchor.quote)}</blockquote><strong>评审人</strong><p>${escapeHtml(comment.body).replace(/\r?\n/g, '<br>')}</p>${replies}</li>`
  }).join('\n')
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>文档评审</title>
<style>body{margin:0;font:16px/1.7 system-ui,-apple-system,"Segoe UI",sans-serif;color:#202124;background:#fff}.page{max-width:920px;margin:0 auto;padding:40px 28px}pre{white-space:pre-wrap;word-break:break-word;font:15px/1.75 ui-monospace,"Cascadia Code",monospace}mark{background:#ffe7a3;color:inherit;border-bottom:2px solid #d99a00}.reviews{border-top:1px solid #ddd;margin-top:36px;padding-top:20px}.reviews li{margin:0 0 20px}.reviews a{color:#1264a3;font-weight:600}.state{margin-left:10px;color:#666;font-size:13px}.reply{margin:8px 0 0 14px;padding-left:12px;border-left:2px solid #ddd}blockquote{margin:8px 0;padding:6px 12px;border-left:3px solid #d99a00;background:#faf7ee;color:#555}p{margin:8px 0}</style>
</head>
<body><main class="page"><pre>${annotatedHtml(sourceContent, comments)}</pre><section class="reviews"><h2>评审清单</h2><ol>${items}</ol></section></main></body>
</html>`
}
