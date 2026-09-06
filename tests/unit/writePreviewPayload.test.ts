import { describe, expect, it } from 'vitest'

import { parseValidatedWritePreview } from '../../src/renderer/src/utils/writePreviewPayload'

describe('parseValidatedWritePreview', () => {
  it('uses the normalized payload returned by the main process', () => {
    expect(parseValidatedWritePreview(JSON.stringify({
      filePath: 'C:\\workspace\\note.md',
      edits: [{ startLine: 2.9, endLine: 3.2, newText: 'updated' }],
      transactionId: 'tx-1',
    }))).toEqual({
      filePath: 'C:\\workspace\\note.md',
      edits: [{ startLine: 2, endLine: 3, newText: 'updated' }],
      transactionId: 'tx-1',
    })
  })

  it('rejects malformed or pathless tool results', () => {
    expect(parseValidatedWritePreview('not-json')).toBeNull()
    expect(parseValidatedWritePreview('{}')).toBeNull()
  })
})
