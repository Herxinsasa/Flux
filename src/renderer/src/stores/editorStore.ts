import { create } from 'zustand'
import type { FileVersion, TextDocumentSnapshot } from '../../../shared/types'
import { getModeConfig } from '../registry/editorModeRegistry'
import type { MarkdownCommandId } from '../components/editor/markdownCommandModel'
import { clearPendingEditorDraft } from '../utils/editorDraftBuffer'
import { EDITOR_RICH_MARKDOWN_MAX_CHARS } from '../../../shared/context-budget'

export type EditorMode = 'text' | 'json' | 'markdown' | 'log'
export type DocumentSessionMode =
  | 'text'
  | 'markdown-source'
  | 'markdown-read'
  | 'markdown-split'
  | 'log'

export interface DocumentSession {
  filePath: string
  draft: string
  dirty: boolean
  mode: DocumentSessionMode
  selection?: { from: number; to: number }
  scrollTop: number
  snapshot: TextDocumentSnapshot | null
  sampled: boolean
  logTotalLines?: number
  lastActivatedAt: number
  /** Monotonically increases with local draft changes. Optional for restored legacy sessions. */
  editGeneration?: number
}

/** State-bar labels retained for existing callers. */
export const EDITOR_MODE_LABEL: Record<EditorMode, string> = {
  text: '文本',
  json: 'JSON',
  markdown: 'Markdown',
  log: '日志',
}

const EDITOR_MODES = new Set<string>(['text', 'json', 'markdown', 'log'])

export function normalizeDocumentPath(filePath: string): string {
  return filePath.replace(/\\/g, '/').toLowerCase()
}

/** Infer editor mode from a file extension string (with or without dot). */
export function inferMode(extOrPath: string): EditorMode {
  const dotIndex = extOrPath.lastIndexOf('.')
  const ext = dotIndex >= 0 ? extOrPath.slice(dotIndex).toLowerCase() : extOrPath.toLowerCase()
  return getModeConfig(ext)?.mode || 'text'
}

export type EditorMenuAction = 'find' | 'select-all'
/** Existing values remain valid; `wysiwyg` is the live rendered Markdown editor. */
export type MarkdownEditSurface = 'wysiwyg' | 'source'

function sessionModeFor(mode: EditorMode, surface: MarkdownEditSurface): DocumentSessionMode {
  if (mode === 'markdown') {
    if (surface === 'source') return 'markdown-source'
    return 'markdown-read'
  }
  return mode === 'log' ? 'log' : 'text'
}

function editorModeFor(sessionMode: DocumentSessionMode): EditorMode {
  if (sessionMode.startsWith('markdown-')) return 'markdown'
  return sessionMode === 'log' ? 'log' : 'text'
}

function surfaceFor(sessionMode: DocumentSessionMode): MarkdownEditSurface {
  if (sessionMode === 'markdown-source') return 'source'
  // Legacy split sessions remain readable after the split surface was removed.
  if (sessionMode === 'markdown-split') return 'source'
  return 'wysiwyg'
}

interface EditorState {
  mode: EditorMode
  content: string
  cursorLine: number
  cursorColumn: number
  selectedText: string | null
  selectedLineRange: { startLine: number; endLine: number } | null
  previewContent: string | null
  isDirty: boolean
  menuUiTick: number
  menuAction: EditorMenuAction | null
  markdownCommandTick: number
  markdownCommand: MarkdownCommandId | null
  jumpOutlineTick: number
  jumpOutlineLine: number
  requestJumpToOutlineLine: (line: number) => void
  changeHighlightTick: number
  changeHighlightStartLine: number
  changeHighlightEndLine: number
  requestHighlightChangedLines: (startLine: number, endLine: number) => void
  markdownEditSurface: MarkdownEditSurface
  setMarkdownEditSurface: (surface: MarkdownEditSurface) => void
  toggleMarkdownEditSurface: () => void
  logIndexedPath: string | null
  logTotalLines: number
  setLogIndexedView: (path: string, totalLines: number) => void
  clearLogIndexedView: () => void
  editorHydrationEpoch: number
  bumpEditorHydration: () => void
  activeDocumentPath: string | null
  documentSessions: Record<string, DocumentSession>
  activateDocument: (filePath: string) => boolean
  beginDocumentLoad: (filePath: string) => void
  setDocumentSnapshot: (filePath: string, snapshot: TextDocumentSnapshot) => void
  setSampledDocument: (filePath: string, content: string, mode: EditorMode) => void
  setDocumentSelection: (selection: { from: number; to: number } | undefined) => void
  setDocumentScrollTop: (scrollTop: number) => void
  commitSavedDocument: (filePath: string, savedContent: string, version: FileVersion, savedGeneration: number) => void
  removeDocument: (filePath: string) => void
  discardDocumentChanges: (filePath: string) => void
  clearDocuments: () => void
  setMode: (modeOrExt: EditorMode | string) => void
  setContent: (content: string) => void
  markDocumentDirty: () => void
  setCursorLine: (line: number) => void
  setCursorColumn: (col: number) => void
  setSelectedText: (text: string | null) => void
  setSelectedLineRange: (range: { startLine: number; endLine: number } | null) => void
  setPreviewContent: (content: string | null) => void
  markClean: () => void
  requestMenuAction: (action: EditorMenuAction) => void
  clearMenuAction: () => void
  requestMarkdownCommand: (command: MarkdownCommandId) => void
  clearMarkdownCommand: () => void
}

function updateActiveSession(
  state: EditorState,
  changes: Partial<DocumentSession>,
): Pick<EditorState, 'documentSessions'> {
  if (!state.activeDocumentPath) return { documentSessions: state.documentSessions }
  const session = state.documentSessions[state.activeDocumentPath]
  if (!session) return { documentSessions: state.documentSessions }
  return {
    documentSessions: {
      ...state.documentSessions,
      [state.activeDocumentPath]: { ...session, ...changes },
    },
  }
}

export const useEditorStore = create<EditorState>((set, get) => ({
  mode: 'text',
  content: '',
  cursorLine: 0,
  cursorColumn: 0,
  selectedText: null,
  selectedLineRange: null,
  previewContent: null,
  isDirty: false,
  menuUiTick: 0,
  menuAction: null,
  markdownCommandTick: 0,
  markdownCommand: null,
  jumpOutlineTick: 0,
  jumpOutlineLine: 0,
  changeHighlightTick: 0,
  changeHighlightStartLine: 0,
  changeHighlightEndLine: 0,
  markdownEditSurface: 'wysiwyg',
  editorHydrationEpoch: 0,
  logIndexedPath: null,
  logTotalLines: 0,
  activeDocumentPath: null,
  documentSessions: {},

  activateDocument: (filePath) => {
    const key = normalizeDocumentPath(filePath)
    const session = get().documentSessions[key]
    if (!session) return false
    const surface = surfaceFor(session.mode)
    set((state) => ({
      activeDocumentPath: key,
      documentSessions: {
        ...state.documentSessions,
        [key]: { ...session, lastActivatedAt: Date.now() },
      },
      content: session.draft,
      isDirty: session.dirty,
      mode: editorModeFor(session.mode),
      markdownEditSurface: surface,
      logIndexedPath: session.mode === 'log' ? filePath : null,
      logTotalLines: session.mode === 'log' ? session.logTotalLines ?? 0 : 0,
      selectedText: null,
      selectedLineRange: null,
      previewContent: null,
      editorHydrationEpoch: state.editorHydrationEpoch + 1,
    }))
    return true
  },

  beginDocumentLoad: (filePath) => {
    const key = normalizeDocumentPath(filePath)
    const mode = inferMode(filePath)
    const session: DocumentSession = {
      filePath,
      draft: '',
      dirty: false,
      mode: sessionModeFor(mode, mode === 'markdown' ? 'source' : get().markdownEditSurface),
      scrollTop: 0,
      snapshot: null,
      sampled: true,
      lastActivatedAt: Date.now(),
      editGeneration: 0,
    }
    set((state) => ({
      activeDocumentPath: key,
      documentSessions: { ...state.documentSessions, [key]: session },
      content: '',
      isDirty: false,
      mode,
      markdownEditSurface: mode === 'markdown' ? 'source' : state.markdownEditSurface,
      selectedText: null,
      selectedLineRange: null,
      previewContent: null,
      editorHydrationEpoch: state.editorHydrationEpoch + 1,
    }))
  },

  setDocumentSnapshot: (filePath, snapshot) => {
    const key = normalizeDocumentPath(filePath)
    const mode = inferMode(filePath)
    const surface = mode === 'markdown'
      ? snapshot.content.length > EDITOR_RICH_MARKDOWN_MAX_CHARS ? 'source' : 'wysiwyg'
      : get().markdownEditSurface
    const session: DocumentSession = {
      filePath,
      draft: snapshot.content,
      dirty: false,
      mode: sessionModeFor(mode, surface),
      scrollTop: 0,
      snapshot,
      sampled: snapshot.sampled,
      lastActivatedAt: Date.now(),
      editGeneration: 0,
    }
    set((state) => ({
      activeDocumentPath: key,
      documentSessions: { ...state.documentSessions, [key]: session },
      content: snapshot.content,
      isDirty: false,
      mode,
      markdownEditSurface: surface,
      logIndexedPath: null,
      logTotalLines: 0,
      selectedText: null,
      selectedLineRange: null,
      previewContent: null,
      editorHydrationEpoch: state.editorHydrationEpoch + 1,
    }))
  },

  setSampledDocument: (filePath, content, mode) => {
    const key = normalizeDocumentPath(filePath)
    const session: DocumentSession = {
      filePath,
      draft: content,
      dirty: false,
      mode: sessionModeFor(mode, mode === 'markdown' ? 'source' : get().markdownEditSurface),
      scrollTop: 0,
      snapshot: null,
      sampled: true,
      lastActivatedAt: Date.now(),
      editGeneration: 0,
    }
    set((state) => ({
      activeDocumentPath: key,
      documentSessions: { ...state.documentSessions, [key]: session },
      content,
      isDirty: false,
      mode,
      markdownEditSurface: mode === 'markdown' ? 'source' : state.markdownEditSurface,
      editorHydrationEpoch: state.editorHydrationEpoch + 1,
    }))
  },

  setDocumentSelection: (selection) => set((state) => updateActiveSession(state, { selection })),
  setDocumentScrollTop: (scrollTop) => set((state) => updateActiveSession(state, { scrollTop })),

  commitSavedDocument: (filePath, savedContent, version, savedGeneration) => {
    const key = normalizeDocumentPath(filePath)
    set((state) => {
      const session = state.documentSessions[key]
      if (!session) return {}
      const changedSinceSave = (session.editGeneration ?? 0) !== savedGeneration || session.draft !== savedContent
      const snapshot = session.snapshot
        ? { ...session.snapshot, content: savedContent, version, sampled: false }
        : null
      return {
        isDirty: state.activeDocumentPath === key ? changedSinceSave : state.isDirty,
        documentSessions: {
          ...state.documentSessions,
          [key]: { ...session, dirty: changedSinceSave, sampled: false, snapshot },
        },
      }
    })
  },

  removeDocument: (filePath) => {
    const key = normalizeDocumentPath(filePath)
    set((state) => {
      const documentSessions = { ...state.documentSessions }
      delete documentSessions[key]
      return {
        documentSessions,
        activeDocumentPath: state.activeDocumentPath === key ? null : state.activeDocumentPath,
      }
    })
  },
  discardDocumentChanges: (filePath) => {
    clearPendingEditorDraft()
    const key = normalizeDocumentPath(filePath)
    set((state) => {
      const session = state.documentSessions[key]
      if (!session?.snapshot) return {}
      const draft = session.snapshot.content
      const active = state.activeDocumentPath === key
      return {
        content: active ? draft : state.content,
        isDirty: active ? false : state.isDirty,
        editorHydrationEpoch: active ? state.editorHydrationEpoch + 1 : state.editorHydrationEpoch,
        documentSessions: {
          ...state.documentSessions,
          [key]: { ...session, draft, dirty: false, editGeneration: 0 },
        },
      }
    })
  },
  clearDocuments: () => set({ activeDocumentPath: null, documentSessions: {} }),

  setLogIndexedView: (path, totalLines) =>
    set((state) => ({
      logIndexedPath: path,
      logTotalLines: totalLines,
      content: '',
      isDirty: false,
      ...updateActiveSession(state, { draft: '', dirty: false, mode: 'log', sampled: true, logTotalLines: totalLines }),
    })),
  clearLogIndexedView: () => set({ logIndexedPath: null, logTotalLines: 0 }),
  bumpEditorHydration: () => set((s) => ({ editorHydrationEpoch: s.editorHydrationEpoch + 1 })),
  requestJumpToOutlineLine: (line) => set((s) => ({ jumpOutlineLine: line, jumpOutlineTick: s.jumpOutlineTick + 1 })),
  requestHighlightChangedLines: (startLine, endLine) =>
    set((s) => ({ changeHighlightStartLine: startLine, changeHighlightEndLine: endLine, changeHighlightTick: s.changeHighlightTick + 1 })),
  setMarkdownEditSurface: (markdownEditSurface) =>
    set((state) => ({
      markdownEditSurface,
      mode: state.mode === 'markdown' ? 'markdown' : state.mode,
      ...updateActiveSession(state, { mode: sessionModeFor(state.mode, markdownEditSurface) }),
    })),
  toggleMarkdownEditSurface: () => {
    const current = get().markdownEditSurface
    get().setMarkdownEditSurface(current === 'wysiwyg' ? 'source' : 'wysiwyg')
  },
  setMode: (modeOrExt) =>
    set((state) => {
      const mode = typeof modeOrExt === 'string' && !EDITOR_MODES.has(modeOrExt)
        ? inferMode(modeOrExt)
        : (modeOrExt as EditorMode)
      return { mode, ...updateActiveSession(state, { mode: sessionModeFor(mode, state.markdownEditSurface) }) }
    }),
  setContent: (content) =>
    set((state) => {
      const session = state.activeDocumentPath ? state.documentSessions[state.activeDocumentPath] : undefined
      return {
        content,
        isDirty: true,
        ...updateActiveSession(state, {
          draft: content,
          dirty: true,
          editGeneration: (session?.editGeneration ?? 0) + 1,
        }),
      }
    }),
  markDocumentDirty: () => set((state) => {
    const session = state.activeDocumentPath ? state.documentSessions[state.activeDocumentPath] : undefined
    if (state.isDirty && session?.dirty) return {}
    return { isDirty: true, ...updateActiveSession(state, { dirty: true }) }
  }),
  setCursorLine: (cursorLine) => set({ cursorLine }),
  setCursorColumn: (cursorColumn) => set({ cursorColumn }),
  setSelectedText: (selectedText) => set({ selectedText }),
  setSelectedLineRange: (selectedLineRange) => set({ selectedLineRange }),
  setPreviewContent: (previewContent) => set({ previewContent }),
  markClean: () => set((state) => ({ isDirty: false, ...updateActiveSession(state, { dirty: false }) })),
  requestMenuAction: (action) => set((s) => ({ menuAction: action, menuUiTick: s.menuUiTick + 1 })),
  clearMenuAction: () => set({ menuAction: null }),
  requestMarkdownCommand: (command) => set((s) => ({ markdownCommand: command, markdownCommandTick: s.markdownCommandTick + 1 })),
  clearMarkdownCommand: () => set({ markdownCommand: null }),
}))
