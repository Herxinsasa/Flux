export interface ValidatedWritePreview {
  filePath: string
  newContent?: string
  edits?: Array<{ startLine: number; endLine: number; newText: string }>
  transactionId?: string
}

export function parseValidatedWritePreview(content: string): ValidatedWritePreview | null {
  let input: unknown
  try {
    input = JSON.parse(content)
  } catch {
    return null
  }

  if (!input || typeof input !== 'object') return null
  const payload = input as Record<string, unknown>
  const filePath = typeof payload.filePath === 'string' ? payload.filePath : ''
  if (!filePath) return null

  const edits = Array.isArray(payload.edits)
    ? payload.edits
      .map((entry) => {
        if (!entry || typeof entry !== 'object') return null
        const row = entry as Record<string, unknown>
        const startLine = Number(row.startLine)
        const endLine = Number(row.endLine)
        if (!Number.isFinite(startLine) || !Number.isFinite(endLine)) return null
        return {
          startLine: Math.floor(startLine),
          endLine: Math.floor(endLine),
          newText: typeof row.newText === 'string' ? row.newText : '',
        }
      })
      .filter((entry): entry is { startLine: number; endLine: number; newText: string } => Boolean(entry))
    : undefined

  return {
    filePath,
    newContent: typeof payload.content === 'string' ? payload.content : undefined,
    edits,
    transactionId: typeof payload.transactionId === 'string' ? payload.transactionId : undefined,
  }
}
