import { useMemo, useCallback, memo, startTransition, useRef, useEffect, useLayoutEffect } from 'react'
import {
  MDXEditor,
  headingsPlugin,
  listsPlugin,
  quotePlugin,
  thematicBreakPlugin,
  markdownShortcutPlugin,
  linkPlugin,
  linkDialogPlugin,
  tablePlugin,
  codeBlockPlugin,
  type MDXEditorMethods,
} from '@mdxeditor/editor'
import '@mdxeditor/editor/style.css'
import { useEditorStore } from '../../stores/editorStore'

/** 流式读盘时 epoch 高频递增，防抖上限避免 Lexical 整文档 import 挤占主线程 */
const HYDRATION_SYNC_DEBOUNCE_MS = 90

interface MdWysiwygEditorProps {
  /** 当前文件路径（切换文件时强制重新挂载以载入磁盘内容） */
  fileKey: string
  onMarkdownCommit: (markdown: string) => void
  /** light / dark，供 MDXEditor 暗色变量 */
  theme: 'light' | 'dark'
}

/**
 * MDXEditor：`markdown` prop 仅在首次挂载时生效（上游文档）。
 * 正文同步策略：
 * - 用户输入：仅 onChange → store，**不递增** editorHydrationEpoch，避免随按键 reflow。
 * - 磁盘/外部：`bumpEditorHydration` + 订阅 epoch，防抖后 `setMarkdown`（流式读盘亦节流）。
 * - 切换文件：`useLayoutEffect` 立即对齐 store，避免可见延迟。
 */
function MdWysiwygEditorInner({ fileKey, onMarkdownCommit, theme }: MdWysiwygEditorProps) {
  const editorRef = useRef<MDXEditorMethods>(null)
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingMarkdownRef = useRef<string | null>(null)

  const plugins = useMemo(
    () => [
      headingsPlugin({ allowedHeadingLevels: [1, 2, 3, 4, 5, 6] }),
      listsPlugin(),
      quotePlugin(),
      thematicBreakPlugin(),
      linkPlugin(),
      linkDialogPlugin(),
      tablePlugin(),
      codeBlockPlugin(),
      markdownShortcutPlugin(),
    ],
    [],
  )

  const flushPendingMarkdown = useCallback(() => {
    debounceTimerRef.current = null
    const md = pendingMarkdownRef.current
    pendingMarkdownRef.current = null
    if (md == null) return
    editorRef.current?.setMarkdown(md)
  }, [])

  const scheduleHydratedMarkdown = useCallback(
    (markdown: string) => {
      pendingMarkdownRef.current = markdown
      if (debounceTimerRef.current != null) return
      debounceTimerRef.current = setTimeout(flushPendingMarkdown, HYDRATION_SYNC_DEBOUNCE_MS)
    },
    [flushPendingMarkdown],
  )

  const handleChange = useCallback(
    (md: string, _initialNormalize: boolean) => {
      startTransition(() => {
        onMarkdownCommit(md)
      })
    },
    [onMarkdownCommit],
  )

  useEffect(() => {
    return () => {
      if (debounceTimerRef.current != null) {
        clearTimeout(debounceTimerRef.current)
      }
    }
  }, [])

  useLayoutEffect(() => {
    if (debounceTimerRef.current != null) {
      clearTimeout(debounceTimerRef.current)
      debounceTimerRef.current = null
    }
    pendingMarkdownRef.current = null
    const md = useEditorStore.getState().content
    editorRef.current?.setMarkdown(md)
  }, [fileKey])

  useEffect(() => {
    let prevEpoch = useEditorStore.getState().editorHydrationEpoch
    return useEditorStore.subscribe((state) => {
      const next = state.editorHydrationEpoch
      if (next === prevEpoch) return
      prevEpoch = next
      scheduleHydratedMarkdown(state.content)
    })
  }, [scheduleHydratedMarkdown])

  const themeWrap =
    theme === 'dark' ? 'dark-theme dark mdx-theme-dark' : 'light-theme light mdx-theme-light'

  return (
    <div className={`flux-mdx-editor-root ${themeWrap}`} style={{ minHeight: 0, height: 'auto' }}>
      <MDXEditor
        ref={editorRef}
        key={fileKey || 'untitled'}
        markdown=""
        readOnly={false}
        onChange={handleChange}
        plugins={plugins}
        trim={false}
        contentEditableClassName="flux-mdx-content"
        className="flux-mdx-editor-inner"
      />
    </div>
  )
}

export const MdWysiwygEditor = memo(MdWysiwygEditorInner)
