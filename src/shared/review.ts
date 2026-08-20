import type { FileVersion, FluxErrorCode } from './types'

export const REVIEW_SCHEMA_VERSION = 1 as const
export const REVIEW_ANCHOR_CONTEXT = 40

export type ReviewAuthor = 'user' | 'ai'
export type ReviewParticipantRole = 'reviewer' | 'modifier'
export type ReviewStatus = 'open' | 'resolved'
export type ReviewAnchorStatus = 'valid' | 'relocated' | 'orphaned'
export type ReviewExportFormat = 'markdown' | 'html'
export type ReviewExportPresentation = 'footnotes' | 'end-list'
export type ReviewExportScope = 'all' | 'open'

export interface ReviewAnchor {
  start: number
  end: number
  quote: string
  prefix: string
  suffix: string
  sourceHash: string
}

export interface ReviewComment {
  id: string
  anchor: ReviewAnchor
  body: string
  author: ReviewAuthor
  status: ReviewStatus
  anchorStatus: ReviewAnchorStatus
  createdAt: string
  updatedAt: string
  replies?: ReviewReply[]
}

export interface ReviewReply {
  id: string
  body: string
  role: ReviewParticipantRole
  createdAt: string
}

export interface ReviewSidecar {
  schemaVersion: typeof REVIEW_SCHEMA_VERSION
  sourcePath: string
  sourceHash: string
  comments: ReviewComment[]
  updatedAt: string
}

export interface ReviewLoadRequest {
  sourcePath: string
  sourceContent: string
}

export interface ReviewLoadResult {
  sidecar: ReviewSidecar
  sidecarVersion: FileVersion | null
  readOnly: boolean
  errorCode?: FluxErrorCode
  error?: string
}

export interface ReviewSaveRequest {
  sidecar: ReviewSidecar
  sourceContent: string
  expectedVersion: FileVersion | null
}

export interface ReviewSaveResult {
  sidecar: ReviewSidecar
  sidecarVersion: FileVersion | null
}

export interface ReviewExportRequest {
  sourcePath: string
  sourceContent: string
  comments: ReviewComment[]
  format: ReviewExportFormat
  presentation: ReviewExportPresentation
  scope: ReviewExportScope
}

export interface ReviewExportResult {
  filePath: string | null
}

export function hashReviewSource(content: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < content.length; index++) {
    hash ^= content.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return `fnv1a32:${(hash >>> 0).toString(16).padStart(8, '0')}:${content.length}`
}

export function createReviewAnchor(
  sourceContent: string,
  start: number,
  end: number,
): ReviewAnchor | null {
  const safeStart = Math.max(0, Math.min(start, sourceContent.length))
  const safeEnd = Math.max(safeStart, Math.min(end, sourceContent.length))
  const quote = sourceContent.slice(safeStart, safeEnd)
  if (!quote) return null
  return {
    start: safeStart,
    end: safeEnd,
    quote,
    prefix: sourceContent.slice(Math.max(0, safeStart - REVIEW_ANCHOR_CONTEXT), safeStart),
    suffix: sourceContent.slice(safeEnd, safeEnd + REVIEW_ANCHOR_CONTEXT),
    sourceHash: hashReviewSource(sourceContent),
  }
}

function findAll(content: string, needle: string): number[] {
  if (!needle) return []
  const matches: number[] = []
  let offset = 0
  while (offset <= content.length - needle.length) {
    const found = content.indexOf(needle, offset)
    if (found < 0) break
    matches.push(found)
    offset = found + Math.max(1, needle.length)
  }
  return matches
}

function contextMatches(content: string, start: number, anchor: ReviewAnchor): boolean {
  const before = content.slice(Math.max(0, start - anchor.prefix.length), start)
  const afterStart = start + anchor.quote.length
  const after = content.slice(afterStart, afterStart + anchor.suffix.length)
  return before === anchor.prefix && after === anchor.suffix
}

export function reanchorReviewComment(
  comment: ReviewComment,
  sourceContent: string,
): ReviewComment {
  const { anchor } = comment
  const exactQuote = sourceContent.slice(anchor.start, anchor.end)
  if (anchor.start >= 0 && anchor.end <= sourceContent.length && exactQuote === anchor.quote) {
    return {
      ...comment,
      anchor: { ...anchor, sourceHash: hashReviewSource(sourceContent) },
      anchorStatus: 'valid',
    }
  }

  const matches = findAll(sourceContent, anchor.quote)
  const contextual = matches.filter((start) => contextMatches(sourceContent, start, anchor))
  const candidates = contextual.length === 1 ? contextual : matches.length === 1 ? matches : []
  if (candidates.length === 1) {
    const relocated = createReviewAnchor(sourceContent, candidates[0], candidates[0] + anchor.quote.length)!
    return { ...comment, anchor: relocated, anchorStatus: 'relocated' }
  }

  return {
    ...comment,
    anchor: { ...anchor, sourceHash: hashReviewSource(sourceContent) },
    anchorStatus: 'orphaned',
  }
}

export function reanchorReviewSidecar(
  sidecar: ReviewSidecar,
  sourceContent: string,
): ReviewSidecar {
  return {
    ...sidecar,
    sourceHash: hashReviewSource(sourceContent),
    comments: sidecar.comments.map((comment) => reanchorReviewComment(comment, sourceContent)),
  }
}

export function sortReviewComments(comments: ReviewComment[]): ReviewComment[] {
  return [...comments].sort((left, right) =>
    left.anchor.start - right.anchor.start ||
    left.createdAt.localeCompare(right.createdAt) ||
    left.id.localeCompare(right.id),
  )
}

export function createEmptyReviewSidecar(sourcePath: string, sourceContent: string): ReviewSidecar {
  return {
    schemaVersion: REVIEW_SCHEMA_VERSION,
    sourcePath,
    sourceHash: hashReviewSource(sourceContent),
    comments: [],
    updatedAt: new Date(0).toISOString(),
  }
}
