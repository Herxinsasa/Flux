import path from 'path'
import { BrowserWindow, dialog } from 'electron'
import type { ReviewExportRequest, ReviewExportResult } from '../../shared/review'
import { reanchorReviewComment } from '../../shared/review'
import { buildReviewHtml, buildReviewMarkdown } from '../../shared/review-export'
import { writeReviewExportAtomic } from './review-export-writer'

export async function exportReviewDocument(request: ReviewExportRequest): Promise<ReviewExportResult> {
  const window = BrowserWindow.getFocusedWindow()
  if (!window) throw new Error('没有可用窗口')
  const comments = request.comments.map((comment) => reanchorReviewComment(comment, request.sourceContent)).filter((comment) =>
    request.scope === 'all' || comment.status === 'open',
  )
  const content = request.format === 'html'
    ? buildReviewHtml(request.sourceContent, comments)
    : buildReviewMarkdown(request.sourceContent, comments, request.presentation)
  const sourceName = path.basename(request.sourcePath, path.extname(request.sourcePath))
  const extension = request.format === 'html' ? 'html' : 'md'
  const result = await dialog.showSaveDialog(window, {
    title: '导出批注',
    defaultPath: `${sourceName}.review.${extension}`,
    filters: request.format === 'html'
      ? [{ name: 'HTML', extensions: ['html'] }]
      : [{ name: 'Markdown', extensions: ['md'] }],
  })
  if (result.canceled || !result.filePath) return { filePath: null }
  await writeReviewExportAtomic(result.filePath, content)
  return { filePath: result.filePath }
}
