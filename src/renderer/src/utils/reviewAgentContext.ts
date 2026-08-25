import type { ReviewComment } from '../../../shared/review'

const REVIEW_REQUEST_PATTERN = /(批注|评审(?:意见)?|审阅(?:意见)?|修改意见|根据.{0,10}意见|review\s*(comments?|notes?))/i
const MAX_REVIEW_COMMENTS = 20
const MAX_REVIEW_CONTEXT_CHARS = 6000

function clip(text: string, maxChars: number): string {
  const normalized = text.trim()
  return normalized.length > maxChars ? `${normalized.slice(0, maxChars)}…` : normalized
}

export function shouldInjectReviewContext(message: string, skillNames: string[]): boolean {
  return REVIEW_REQUEST_PATTERN.test(message) || skillNames.some((name) => REVIEW_REQUEST_PATTERN.test(name))
}

export function buildReviewAgentContext(filePath: string, comments: ReviewComment[]): string | null {
  const openComments = comments.filter((comment) => comment.status === 'open')
  if (openComments.length === 0) return null

  const lines = [
    '【当前文档批注】',
    `目标文件：${filePath}`,
    '以下内容来自 Flux 批注系统。分析或修改目标文件时遵循这些意见；不要修改 .review.json。需要改文档时使用 write_file 生成待确认的修改预览。',
  ]
  for (const [index, comment] of openComments.slice(0, MAX_REVIEW_COMMENTS).entries()) {
    lines.push('')
    lines.push(`批注 ${index + 1}（${comment.anchorStatus === 'orphaned' ? '定位失效' : '可定位'}）`)
    lines.push(`引用：${clip(comment.anchor.quote, 500)}`)
    lines.push(`意见：${clip(comment.body, 1200)}`)
    for (const reply of (comment.replies ?? []).slice(-5)) {
      lines.push(`${reply.role === 'reviewer' ? '评审人' : '修改人'}回复：${clip(reply.body, 600)}`)
    }
  }
  if (openComments.length > MAX_REVIEW_COMMENTS) {
    lines.push('', `另有 ${openComments.length - MAX_REVIEW_COMMENTS} 条未解决批注未注入。`)
  }

  const result = lines.join('\n')
  return result.length > MAX_REVIEW_CONTEXT_CHARS
    ? `${result.slice(0, MAX_REVIEW_CONTEXT_CHARS)}\n… [批注上下文已截断]`
    : result
}
