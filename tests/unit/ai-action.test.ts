import { describe, expect, it } from 'vitest'
import {
  buildSelectionActionPrompt,
  createAiSelectionRequest,
  parseAiReviewResponse,
  sampleDocumentForReview,
  validateAiSelectionApplication,
} from '../../src/shared/ai-action'

function requestFor(content = 'Flux makes text review safer.') {
  return createAiSelectionRequest({
    requestId: 'req-1',
    action: 'rewrite',
    sourcePath: 'F:\\docs\\a.md',
    sourceContent: content,
    sourceVersion: null,
    start: 0,
    end: content.length,
  })
}

describe('AI selection actions', () => {
  it('builds a fixed prompt from a bounded selection', () => {
    const prompt = buildSelectionActionPrompt(requestFor())
    expect(prompt.system).toContain('固定动作')
    expect(prompt.user).toContain('Flux makes text review safer.')
  })

  it('rejects overlong selections instead of silently truncating', () => {
    const content = 'x'.repeat(8001)
    expect(() => buildSelectionActionPrompt(requestFor(content))).toThrow('1-8,000')
  })

  it('refuses stale document and selection application', () => {
    const request = requestFor()
    expect(validateAiSelectionApplication(request, { sourcePath: request.sourcePath, sourceContent: 'changed', sourceVersion: null })).toContain('文档内容已变化')
    expect(validateAiSelectionApplication(request, { sourcePath: 'F:\\docs\\other.md', sourceContent: request.selectedText, sourceVersion: null })).toContain('文档已切换')
    expect(validateAiSelectionApplication(request, { sourcePath: 'f:/docs/a.md', sourceContent: request.selectedText, sourceVersion: null })).toBeNull()
  })
})

describe('structured AI review', () => {
  it('parses valid findings and repairs a unique quote range', () => {
    const content = 'Alpha text. Beta issue. Gamma.'
    const raw = JSON.stringify({ findings: [{ id: 'f1', category: 'logic', severity: 'warning', quote: 'Beta issue', start: 0, end: 2, comment: 'Reasoning is incomplete.', suggestion: 'Add evidence.' }] })
    const result = parseAiReviewResponse(raw, content)
    expect(result.ok).toBe(true)
    expect(result.findings[0]).toMatchObject({ start: 12, end: 22, locatable: true })
  })

  it('keeps invalid JSON as a read-only raw result', () => {
    const result = parseAiReviewResponse('not json', 'document')
    expect(result).toMatchObject({ ok: false, findings: [], rawText: 'not json' })
  })

  it('samples oversized documents with explicit coverage', () => {
    const sample = sampleDocumentForReview('a'.repeat(30_000))
    expect(sample.coverage).toContain('24,000')
    expect(sample.text.length).toBeLessThan(25_000)
  })
})
