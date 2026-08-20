import { create } from 'zustand'
import {
  AI_ACTION_PROMPT_VERSION,
  createAiSelectionRequest,
  parseAiReviewResponse,
  type AiActionRunResult,
  type AiDocumentReviewRequest,
  type AiReviewFinding,
  type AiSelectionActionId,
  type AiSelectionActionRequest,
} from '../../../shared/ai-action'
import { hashReviewSource } from '../../../shared/review'
import type { FileVersion } from '../../../shared/types'

type RequestStatus = 'idle' | 'running' | 'ready' | 'error'

export interface SelectionActionState {
  status: RequestStatus
  request: AiSelectionActionRequest
  result?: AiActionRunResult
  error?: string
}

export interface PendingReviewState {
  status: RequestStatus
  request: AiDocumentReviewRequest
  findings: AiReviewFinding[]
  decisions: Record<string, 'pending' | 'accepted' | 'rejected'>
  rawText?: string
  parseError?: string
  coverage?: string
  error?: string
}

interface AiActionState {
  selections: Record<string, SelectionActionState | undefined>
  reviews: Record<string, PendingReviewState | undefined>
  runSelection: (input: { action: AiSelectionActionId; sourcePath: string; sourceContent: string; sourceVersion: FileVersion | null; start: number; end: number }) => Promise<void>
  cancelSelection: (sourcePath: string) => Promise<void>
  rejectSelection: (sourcePath: string) => void
  runDocumentReview: (sourcePath: string, sourceContent: string, sourceVersion: FileVersion | null) => Promise<void>
  cancelDocumentReview: (sourcePath: string) => Promise<void>
  decideFindings: (sourcePath: string, findingIds: string[], decision: 'accepted' | 'rejected') => void
}

function keyOf(sourcePath: string): string {
  return sourcePath.replace(/\\/g, '/').toLowerCase()
}

function requestId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

export const useAiActionStore = create<AiActionState>((set, get) => ({
  selections: {},
  reviews: {},
  runSelection: async (input) => {
    const key = keyOf(input.sourcePath)
    if (get().selections[key]?.status === 'running') return
    const request = createAiSelectionRequest({ ...input, requestId: requestId('selection') })
    set((state) => ({ selections: { ...state.selections, [key]: { status: 'running', request } } }))
    const response = await window.electronAPI.aiAction.run(request)
    if (get().selections[key]?.request.requestId !== request.requestId) return
    set((state) => ({ selections: { ...state.selections, [key]: response.success && response.data && response.data.requestId === request.requestId
      ? { status: 'ready', request, result: response.data }
      : { status: 'error', request, error: response.error ?? 'AI 操作失败' } } }))
  },
  cancelSelection: async (sourcePath) => {
    const key = keyOf(sourcePath)
    const current = get().selections[key]
    if (!current || current.status !== 'running') return
    await window.electronAPI.aiAction.cancel(sourcePath, current.request.requestId)
  },
  rejectSelection: (sourcePath) => set((state) => ({ selections: { ...state.selections, [keyOf(sourcePath)]: undefined } })),
  runDocumentReview: async (sourcePath, sourceContent, sourceVersion) => {
    const key = keyOf(sourcePath)
    if (get().reviews[key]?.status === 'running') return
    const request: AiDocumentReviewRequest = {
      kind: 'document-review',
      requestId: requestId('review'),
      promptVersion: AI_ACTION_PROMPT_VERSION,
      sourcePath,
      sourceHash: hashReviewSource(sourceContent),
      sourceVersion,
      sourceContent,
    }
    set((state) => ({ reviews: { ...state.reviews, [key]: { status: 'running', request, findings: [], decisions: {} } } }))
    const response = await window.electronAPI.aiAction.run(request)
    if (get().reviews[key]?.request.requestId !== request.requestId) return
    if (!response.success || !response.data) {
      set((state) => ({ reviews: { ...state.reviews, [key]: { status: 'error', request, findings: [], decisions: {}, error: response.error ?? 'AI 审阅失败' } } }))
      return
    }
    const parsed = parseAiReviewResponse(response.data.rawText, sourceContent)
    set((state) => ({ reviews: { ...state.reviews, [key]: {
      status: 'ready', request, findings: parsed.findings,
      decisions: Object.fromEntries(parsed.findings.map((finding) => [finding.id, 'pending'])),
      rawText: response.data!.rawText, parseError: parsed.error, coverage: response.data!.coverage,
    } } }))
  },
  cancelDocumentReview: async (sourcePath) => {
    const key = keyOf(sourcePath)
    const current = get().reviews[key]
    if (!current || current.status !== 'running') return
    await window.electronAPI.aiAction.cancel(sourcePath, current.request.requestId)
  },
  decideFindings: (sourcePath, findingIds, decision) => set((state) => {
    const key = keyOf(sourcePath)
    const current = state.reviews[key]
    if (!current) return state
    const decisions = { ...current.decisions }
    for (const id of findingIds) decisions[id] = decision
    return { reviews: { ...state.reviews, [key]: { ...current, decisions } } }
  }),
}))
