import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { buildReviewHtml, buildReviewMarkdown } from '../../src/shared/review-export'
import { createReviewAnchor, type ReviewComment } from '../../src/shared/review'
import { writeReviewExportAtomic } from '../../src/main/services/review-export-writer'

function makeComment(source: string, body: string): ReviewComment {
  return {
    id: 'comment-1',
    anchor: createReviewAnchor(source, 0, source.length)!,
    body,
    author: 'user',
    status: 'open',
    anchorStatus: 'valid',
    createdAt: '2026-08-06T00:00:00.000Z',
    updatedAt: '2026-08-06T00:00:00.000Z',
  }
}

describe('review export', () => {
  let tempDir: string
  beforeEach(() => { tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flux-review-export-')) })
  afterEach(() => fs.rmSync(tempDir, { recursive: true, force: true }))

  it('builds numbered Markdown with escaped review text', () => {
    const output = buildReviewMarkdown('hello', [makeComment('hello', '<script>[x]')], 'footnotes')
    expect(output).toContain('hello[^flux-review-1]')
    expect(output).toContain('## 评审清单')
    expect(output).toContain('&lt;script&gt;\\[x\\]')
  })

  it('escapes source and comments in standalone HTML', () => {
    const output = buildReviewHtml('<img src=x>', [makeComment('<img src=x>', '<script>alert(1)</script>')])
    expect(output).toContain('<!doctype html>')
    expect(output).toContain('&lt;img src=x&gt;')
    expect(output).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
    expect(output).not.toContain('<script>alert(1)</script>')
  })

  it('keeps multiline replies attached to their reviewer/modifier thread', () => {
    const comment = makeComment('hello', 'review')
    comment.replies = [{ id: 'reply', body: 'first\n\nsecond', role: 'modifier', createdAt: '2026-08-06T00:01:00.000Z' }]
    const markdown = buildReviewMarkdown('hello', [comment], 'end-list')
    const html = buildReviewHtml('hello', [comment])
    expect(markdown).toContain('修改人回复：first<br><br>')
    expect(markdown).toContain('second')
    expect(html).toContain('<strong>修改人</strong>')
  })

  it('writes atomically and removes the temporary file when rename fails', async () => {
    const successPath = path.join(tempDir, 'review.md')
    await writeReviewExportAtomic(successPath, 'complete')
    expect(fs.readFileSync(successPath, 'utf8')).toBe('complete')
    expect(fs.readdirSync(tempDir).some((name) => name.includes('.tmp-'))).toBe(false)

    const directoryTarget = path.join(tempDir, 'cannot-replace')
    fs.mkdirSync(directoryTarget)
    await expect(writeReviewExportAtomic(directoryTarget, 'partial')).rejects.toBeTruthy()
    expect(fs.readdirSync(tempDir).some((name) => name.startsWith('cannot-replace.tmp-'))).toBe(false)
  })
})
