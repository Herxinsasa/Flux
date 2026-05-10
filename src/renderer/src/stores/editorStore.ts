import { create } from 'zustand'
import { getModeConfig } from '../registry/editorModeRegistry'

export type EditorMode = 'text' | 'json' | 'markdown' | 'log'

/** 状态栏等处的模式展示名 */
export const EDITOR_MODE_LABEL: Record<EditorMode, string> = {
  text: '纯文本',
  json: 'JSON',
  markdown: 'Markdown',
  log: '日志',
}

const EDITOR_MODES = new Set<string>(['text', 'json', 'markdown', 'log'])

/** Infer editor mode from a file extension string (with or without dot). */
export function inferMode(extOrPath: string): EditorMode {
  const dotIndex = extOrPath.lastIndexOf('.')
  const ext = dotIndex >= 0 ? extOrPath.slice(dotIndex).toLowerCase() : extOrPath.toLowerCase()
  return getModeConfig(ext)?.mode || 'text'
}

export type EditorMenuAction = 'find' | 'select-all'

/** Markdown：实时渲染（类 Typora）与源码编辑器切换 */
export type MarkdownEditSurface = 'wysiwyg' | 'source' | 'split'

interface EditorState {
  mode: EditorMode
  content: string
  cursorLine: number
  cursorColumn: number
  selectedText: string | null
  selectedLineRange: { startLine: number; endLine: number } | null
  previewContent: string | null
  isDirty: boolean
  /** 菜单栏触发的命令（由 EditorPane 消费后清除） */
  menuUiTick: number
  menuAction: EditorMenuAction | null
  pendingInsertTick: number
  pendingInsert: string | null
  /** Markdown 大纲点击：跳转到源码行（由 EditorPane 消费） */
  jumpOutlineTick: number
  jumpOutlineLine: number
  requestJumpToOutlineLine: (line: number) => void
  changeHighlightTick: number
  changeHighlightStartLine: number
  changeHighlightEndLine: number
  requestHighlightChangedLines: (startLine: number, endLine: number) => void
  /** Markdown 专用：默认实时渲染；源码模式为 CodeMirror */
  markdownEditSurface: MarkdownEditSurface
  setMarkdownEditSurface: (surface: MarkdownEditSurface) => void
  toggleMarkdownEditSurface: () => void
  /**
   * 仅在外部替换编辑器正文时递增（磁盘加载、切换文件时的清空/写入）。
   * MD 预览通过订阅该 epoch + ref.setMarkdown 同步，避免随按键把 Lexical 整文档重灌。
   */
  editorHydrationEpoch: number
  bumpEditorHydration: () => void
  /** Accept an EditorMode directly, or a file extension/path to auto-infer. */
  setMode: (modeOrExt: EditorMode | string) => void
  setContent: (content: string) => void
  setCursorLine: (line: number) => void
  setCursorColumn: (col: number) => void
  setSelectedText: (text: string | null) => void
  setSelectedLineRange: (range: { startLine: number; endLine: number } | null) => void
  setPreviewContent: (content: string | null) => void
  markClean: () => void
  requestMenuAction: (action: EditorMenuAction) => void
  clearMenuAction: () => void
  requestInsertAtCursor: (text: string) => void
  clearPendingInsert: () => void
}

export const useEditorStore = create<EditorState>((set) => ({
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
  pendingInsertTick: 0,
  pendingInsert: null,
  jumpOutlineTick: 0,
  jumpOutlineLine: 0,
  changeHighlightTick: 0,
  changeHighlightStartLine: 0,
  changeHighlightEndLine: 0,
  markdownEditSurface: 'wysiwyg',
  editorHydrationEpoch: 0,

  bumpEditorHydration: () =>
    set((s) => ({ editorHydrationEpoch: s.editorHydrationEpoch + 1 })),

  requestJumpToOutlineLine: (line) =>
    set((s) => ({
      jumpOutlineLine: line,
      jumpOutlineTick: s.jumpOutlineTick + 1,
    })),

  requestHighlightChangedLines: (startLine, endLine) =>
    set((s) => ({
      changeHighlightStartLine: startLine,
      changeHighlightEndLine: endLine,
      changeHighlightTick: s.changeHighlightTick + 1,
    })),

  setMarkdownEditSurface: (markdownEditSurface) => set({ markdownEditSurface }),

  toggleMarkdownEditSurface: () =>
    set((s) => ({
      markdownEditSurface:
        s.markdownEditSurface === 'wysiwyg'
          ? 'source'
          : s.markdownEditSurface === 'source'
            ? 'split'
            : 'wysiwyg',
    })),

  setMode: (modeOrExt) =>
    set({
      mode:
        typeof modeOrExt === 'string' && !EDITOR_MODES.has(modeOrExt)
          ? inferMode(modeOrExt)
          : (modeOrExt as EditorMode),
    }),

  setContent: (content) => set({ content, isDirty: true }),
  setCursorLine: (cursorLine) => set({ cursorLine }),
  setCursorColumn: (cursorColumn) => set({ cursorColumn }),
  setSelectedText: (selectedText) => set({ selectedText }),
  setSelectedLineRange: (selectedLineRange) => set({ selectedLineRange }),
  setPreviewContent: (previewContent) => set({ previewContent }),
  markClean: () => set({ isDirty: false }),

  requestMenuAction: (action) =>
    set((s) => ({
      menuAction: action,
      menuUiTick: s.menuUiTick + 1,
    })),
  clearMenuAction: () => set({ menuAction: null }),

  requestInsertAtCursor: (text) =>
    set((s) => ({
      pendingInsert: text,
      pendingInsertTick: s.pendingInsertTick + 1,
    })),
  clearPendingInsert: () => set({ pendingInsert: null }),
}))
