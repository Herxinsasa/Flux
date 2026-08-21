import { create } from 'zustand'
import {
  createReviewAnchor,
  createEmptyReviewSidecar,
  reanchorReviewSidecar,
  type ReviewAnchor,
  type ReviewComment,
  type ReviewExportFormat,
  type ReviewExportPresentation,
  type ReviewExportScope,
  type ReviewParticipantRole,
  type ReviewSidecar,
} from '../../../shared/review'
import type { FileVersion, FluxErrorCode } from '../../../shared/types'
import { normalizeDocumentPath } from './editorStore'

export interface ReviewDocumentState {
  sourcePath: string
  sidecar: ReviewSidecar
  sidecarVersion: FileVersion | null
  loading: boolean
  saving: boolean
  readOnly: boolean
  error: string | null
  errorCode?: FluxErrorCode
  sourceContent: string
  sourceGeneration: number
  saveGeneration: number
}

interface ReviewState {
  documents: Record<string, ReviewDocumentState>
  panelOpen: boolean
  panelWidth: number
  filter: 'open' | 'all'
  activeCommentId: string | null
  /** 双击定位请求计数：同一批注重复双击时递增，编辑器据此强制重新跳转 */
  locateTick: number
  loadDocument: (sourcePath: string, sourceContent: string) => Promise<void>
  reanchorDocument: (sourcePath: string, sourceContent: string) => void
  addComment: (sourcePath: string, sourceContent: string, anchor: ReviewAnchor, body: string) => Promise<boolean>
  addAiComments: (sourcePath: string, sourceContent: string, comments: Array<{ anchor: ReviewAnchor; body: string }>) => Promise<boolean>
  addReply: (sourcePath: string, sourceContent: string, commentId: string, body: string, role: ReviewParticipantRole) => Promise<boolean>
  updateComment: (sourcePath: string, sourceContent: string, commentId: string, patch: Partial<Pick<ReviewComment, 'body' | 'status' | 'anchor' | 'anchorStatus'>>) => Promise<boolean>
  deleteComment: (sourcePath: string, sourceContent: string, commentId: string) => Promise<boolean>
  reattachComment: (sourcePath: string, sourceContent: string, commentId: string, start: number, end: number) => Promise<boolean>
  exportDocument: (sourcePath: string, sourceContent: string, format: ReviewExportFormat, presentation: ReviewExportPresentation, scope: ReviewExportScope) => Promise<string | null>
  openPanel: () => void
  closePanel: () => void
  togglePanel: () => void
  setPanelWidth: (width: number) => void
  setFilter: (filter: 'open' | 'all') => void
  setActiveCommentId: (commentId: string | null) => void
  /** 双击批注项跳转：设置 active 并递增 tick，即使目标与当前相同也会触发编辑器重新定位 */
  requestLocate: (commentId: string) => void
}

const loadRequests = new Map<string, number>()
const MAX_SAVE_ATTEMPTS = 3

function nextCommentId(): string {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID()
  return `review-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

export const useReviewStore = create<ReviewState>((set, get) => {
  const saveDocument = async (
    sourcePath: string,
    sourceContent: string,
    sidecar: ReviewSidecar,
    attempt = 1,
  ): Promise<boolean> => {
    const key = normalizeDocumentPath(sourcePath)
    const current = get().documents[key]
    if (!current || current.readOnly || current.loading || current.saving) return false
    const requestGeneration = current.saveGeneration + 1
    const sourceGeneration = current.sourceGeneration
    const sourceHash = sidecar.sourceHash
    const expectedVersion = current.sidecarVersion
    set((state) => ({
      documents: {
        ...state.documents,
        [key]: {
          ...current,
          sidecar,
          sourceContent,
          saving: true,
          saveGeneration: requestGeneration,
          error: null,
          errorCode: undefined,
        },
      },
    }))
    const response = await window.electronAPI.review.save({
      sidecar,
      sourceContent,
      expectedVersion,
    })
    if (!response.success || !response.data) {
      set((state) => ({
        documents: {
          ...state.documents,
          [key]: { ...state.documents[key], saving: false, error: response.error ?? '批注保存失败', errorCode: response.code },
        },
      }))
      return false
    }
    const latest = get().documents[key]
    const isCurrent = latest
      && latest.saveGeneration === requestGeneration
      && latest.sourceGeneration === sourceGeneration
      && latest.sidecar.sourceHash === sourceHash
      && latest.sidecarVersion === expectedVersion
    if (isCurrent) {
      set((state) => ({
        documents: {
          ...state.documents,
          [key]: {
            ...state.documents[key],
            sidecar: response.data!.sidecar,
            sidecarVersion: response.data!.sidecarVersion,
            saving: false,
            error: null,
            errorCode: undefined,
          },
        },
      }))
      return true
    }

    // The sidecar write succeeded, but the in-memory anchors moved while it was in flight.
    // Keep the newer anchors, carry only the concurrency token forward, then persist them.
    set((state) => ({
      documents: {
        ...state.documents,
        [key]: {
          ...state.documents[key],
          sidecarVersion: response.data!.sidecarVersion,
          saving: false,
        },
      },
    }))
    const currentAfterSave = get().documents[key]
    if (attempt >= MAX_SAVE_ATTEMPTS) return true
    return currentAfterSave
      ? saveDocument(sourcePath, currentAfterSave.sourceContent, currentAfterSave.sidecar, attempt + 1)
      : false
  }

  return {
    documents: {},
    panelOpen: false,
    panelWidth: 320,
    filter: 'open',
    activeCommentId: null,
    locateTick: 0,

    loadDocument: async (sourcePath, sourceContent) => {
      const key = normalizeDocumentPath(sourcePath)
      const requestId = (loadRequests.get(key) ?? 0) + 1
      loadRequests.set(key, requestId)
      const previous = get().documents[key]
      const saveWasInFlight = previous?.saving === true
      const pending: ReviewDocumentState = previous ?? {
        sourcePath,
        sidecar: createEmptyReviewSidecar(sourcePath, sourceContent),
        sidecarVersion: null,
        loading: true,
        saving: false,
        readOnly: false,
        error: null,
        sourceContent,
        sourceGeneration: 0,
        saveGeneration: 0,
      }
      set((state) => ({ documents: { ...state.documents, [key]: { ...pending, loading: true } } }))
      const response = await window.electronAPI.review.load({ sourcePath, sourceContent })
      if (loadRequests.get(key) !== requestId) return
      if (saveWasInFlight) {
        set((state) => ({ documents: { ...state.documents, [key]: { ...state.documents[key], loading: false } } }))
        return
      }
      if (!response.success || !response.data) {
        set((state) => ({
          documents: { ...state.documents, [key]: { ...pending, loading: false, error: response.error ?? '批注加载失败', errorCode: response.code } },
        }))
        return
      }
      set((state) => ({
        documents: {
          ...state.documents,
          [key]: {
            sourcePath,
            sidecar: response.data!.sidecar,
            sidecarVersion: response.data!.sidecarVersion,
            loading: false,
            saving: false,
            readOnly: response.data!.readOnly,
            error: response.data!.error ?? null,
            errorCode: response.data!.errorCode,
            sourceContent,
            sourceGeneration: 0,
            saveGeneration: previous?.saveGeneration ?? 0,
          },
        },
      }))
    },

    reanchorDocument: (sourcePath, sourceContent) => {
      const key = normalizeDocumentPath(sourcePath)
      const document = get().documents[key]
      if (!document || document.loading || document.sidecar.comments.length === 0) return
      const sidecar = reanchorReviewSidecar(document.sidecar, sourceContent)
      const sourceChanged = sidecar.sourceHash !== document.sidecar.sourceHash
      set((state) => ({
        documents: {
          ...state.documents,
          [key]: {
            ...document,
            sidecar,
            sourceContent,
            sourceGeneration: document.sourceGeneration + (sourceChanged ? 1 : 0),
          },
        },
      }))
    },

    addComment: async (sourcePath, sourceContent, anchor, body) => {
      const key = normalizeDocumentPath(sourcePath)
      const document = get().documents[key]
      if (!document || document.readOnly || document.loading || !body.trim()) return false
      const now = new Date().toISOString()
      const comment: ReviewComment = {
        id: nextCommentId(),
        anchor,
        body: body.trim(),
        author: 'user',
        status: 'open',
        anchorStatus: 'valid',
        createdAt: now,
        updatedAt: now,
      }
      const saved = await saveDocument(sourcePath, sourceContent, {
        ...document.sidecar,
        comments: [...document.sidecar.comments, comment],
        updatedAt: now,
      })
      if (saved) set({ panelOpen: true, activeCommentId: comment.id })
      return saved
    },

    addAiComments: async (sourcePath, sourceContent, comments) => {
      const key = normalizeDocumentPath(sourcePath)
      const document = get().documents[key]
      const valid = comments.filter((comment) => comment.body.trim() && comment.anchor.quote)
      if (!document || document.readOnly || document.loading || valid.length === 0) return false
      const now = new Date().toISOString()
      const additions: ReviewComment[] = valid.map((comment) => ({
        id: nextCommentId(),
        anchor: comment.anchor,
        body: comment.body.trim(),
        author: 'ai',
        status: 'open',
        anchorStatus: 'valid',
        createdAt: now,
        updatedAt: now,
      }))
      const saved = await saveDocument(sourcePath, sourceContent, {
        ...document.sidecar,
        comments: [...document.sidecar.comments, ...additions],
        updatedAt: now,
      })
      if (saved) set({ panelOpen: true, activeCommentId: additions[0].id })
      return saved
    },

    addReply: async (sourcePath, sourceContent, commentId, body, role) => {
      const key = normalizeDocumentPath(sourcePath)
      const document = get().documents[key]
      const trimmedBody = body.trim()
      if (!document || document.readOnly || document.loading || !trimmedBody) return false
      const now = new Date().toISOString()
      return saveDocument(sourcePath, sourceContent, {
        ...document.sidecar,
        comments: document.sidecar.comments.map((comment) => comment.id === commentId ? {
          ...comment,
          replies: [...(comment.replies ?? []), {
            id: nextCommentId(),
            body: trimmedBody,
            role,
            createdAt: now,
          }],
          updatedAt: now,
        } : comment),
        updatedAt: now,
      })
    },

    updateComment: async (sourcePath, sourceContent, commentId, patch) => {
      const key = normalizeDocumentPath(sourcePath)
      const document = get().documents[key]
      if (!document || document.readOnly || document.loading) return false
      const now = new Date().toISOString()
      return saveDocument(sourcePath, sourceContent, {
        ...document.sidecar,
        comments: document.sidecar.comments.map((comment) =>
          comment.id === commentId ? { ...comment, ...patch, updatedAt: now } : comment,
        ),
        updatedAt: now,
      })
    },

    deleteComment: async (sourcePath, sourceContent, commentId) => {
      const key = normalizeDocumentPath(sourcePath)
      const document = get().documents[key]
      if (!document || document.readOnly || document.loading) return false
      const saved = await saveDocument(sourcePath, sourceContent, {
        ...document.sidecar,
        comments: document.sidecar.comments.filter((comment) => comment.id !== commentId),
        updatedAt: new Date().toISOString(),
      })
      if (saved && get().activeCommentId === commentId) set({ activeCommentId: null })
      return saved
    },

    reattachComment: async (sourcePath, sourceContent, commentId, start, end) => {
      const anchor = createReviewAnchor(sourceContent, start, end)
      if (!anchor) return false
      return get().updateComment(sourcePath, sourceContent, commentId, { anchor, anchorStatus: 'valid' })
    },

    exportDocument: async (sourcePath, sourceContent, format, presentation, scope) => {
      const document = get().documents[normalizeDocumentPath(sourcePath)]
      if (!document) return null
      const response = await window.electronAPI.review.export({
        sourcePath,
        sourceContent,
        comments: document.sidecar.comments,
        format,
        presentation,
        scope,
      })
      if (!response.success || !response.data) {
        set((state) => ({
          documents: {
            ...state.documents,
            [normalizeDocumentPath(sourcePath)]: { ...document, error: response.error ?? '导出失败', errorCode: response.code },
          },
        }))
        return null
      }
      return response.data.filePath
    },

    openPanel: () => set({ panelOpen: true }),
    closePanel: () => set({ panelOpen: false, activeCommentId: null }),
    togglePanel: () => set((state) => ({ panelOpen: !state.panelOpen })),
    setPanelWidth: (width) => set({ panelWidth: Math.max(280, Math.min(520, Math.round(width))) }),
    setFilter: (filter) => set({ filter }),
    setActiveCommentId: (activeCommentId) => set({ activeCommentId }),
    requestLocate: (commentId) => set((state) => ({ activeCommentId: commentId, locateTick: state.locateTick + 1 })),
  }
})
