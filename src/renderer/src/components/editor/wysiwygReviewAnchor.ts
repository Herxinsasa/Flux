import { createReviewAnchor, type ReviewAnchor } from '../../../../shared/review'

export function resolveSerializedReviewAnchor(
  sourceMarkdown: string,
  markedMarkdown: string,
  startMarker: string,
  endMarker: string,
): ReviewAnchor | null {
  const markedStart = markedMarkdown.indexOf(startMarker)
  const markedEnd = markedMarkdown.indexOf(endMarker)
  if (markedStart < 0 || markedEnd < markedStart) return null

  const canonical = markedMarkdown.replace(startMarker, '').replace(endMarker, '')
  const canonicalStart = markedStart
  const canonicalEnd = markedEnd - startMarker.length
  if (sourceMarkdown === canonical) {
    return createReviewAnchor(sourceMarkdown, canonicalStart, canonicalEnd)
  }

  const selectedMarkdown = canonical.slice(canonicalStart, canonicalEnd)
  if (!selectedMarkdown) return null
  const expected = canonical.length > 0
    ? Math.round((canonicalStart / canonical.length) * sourceMarkdown.length)
    : 0
  let best = -1
  let searchFrom = 0
  while (searchFrom <= sourceMarkdown.length) {
    const match = sourceMarkdown.indexOf(selectedMarkdown, searchFrom)
    if (match < 0) break
    if (best < 0 || Math.abs(match - expected) < Math.abs(best - expected)) best = match
    searchFrom = match + Math.max(1, selectedMarkdown.length)
  }
  return best >= 0
    ? createReviewAnchor(sourceMarkdown, best, best + selectedMarkdown.length)
    : null
}
