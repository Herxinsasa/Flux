import { act, render, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { MdWysiwygEditor } from '../../src/renderer/src/components/editor/MdWysiwygEditor'
import { useEditorStore } from '../../src/renderer/src/stores/editorStore'

const { replaceAll, editorInstances, editorFactory, editorControl } = vi.hoisted(() => {
  const replaceAll = vi.fn((markdown: string) => ({ markdown }))
  const editorControl = {
    deferCreate: false,
    releaseCreate: null as (() => void) | null,
  }
  const editorInstances: Array<{
    configCallbacks: Array<(ctx: unknown) => void>
    markdownListener?: (_ctx: unknown, markdown: string) => void
    create: ReturnType<typeof vi.fn>
    destroy: ReturnType<typeof vi.fn>
    action: ReturnType<typeof vi.fn>
  }> = []
  const editorFactory = vi.fn(() => {
    const instance = {
      configCallbacks: [] as Array<(ctx: unknown) => void>,
      markdownListener: undefined as ((_ctx: unknown, markdown: string) => void) | undefined,
      config(callback: (ctx: unknown) => void) {
        this.configCallbacks.push(callback)
        return this
      },
      use() {
        return this
      },
      create: vi.fn(async function (this: typeof instance) {
        if (editorControl.deferCreate) {
          await new Promise<void>((resolve) => {
            editorControl.releaseCreate = resolve
          })
        }
        const ctx = {
          set: vi.fn(),
          get: vi.fn(() => ({
            markdownUpdated: (callback: typeof instance.markdownListener) => {
              instance.markdownListener = callback
            },
            handlers: {},
          })),
          update: vi.fn(),
        }
        this.configCallbacks.forEach((callback) => callback(ctx))
      }),
      destroy: vi.fn(async () => undefined),
      action: vi.fn(),
    }
    editorInstances.push(instance)
    return instance
  })
  return { replaceAll, editorInstances, editorFactory, editorControl }
})

vi.mock('@milkdown/kit/core', () => ({
  Editor: { make: editorFactory },
  commandsCtx: {},
  defaultValueCtx: {},
  editorViewCtx: {},
  remarkStringifyOptionsCtx: {},
  rootCtx: {},
  serializerCtx: {},
}))
vi.mock('@milkdown/kit/preset/commonmark', () => ({
  commonmark: {},
  wrapInBlockquoteCommand: { key: 'blockquote' },
}))
vi.mock('@milkdown/kit/preset/gfm', () => ({
  gfm: [],
  remarkGFMPlugin: { options: {} },
  strikethroughInputRule: {},
  strikethroughSchema: { type: vi.fn() },
}))
vi.mock('@milkdown/kit/plugin/clipboard', () => ({ clipboard: {} }))
vi.mock('@milkdown/kit/plugin/history', () => ({ history: {} }))
vi.mock('@milkdown/kit/plugin/listener', () => ({ listener: {}, listenerCtx: {} }))
vi.mock('@milkdown/kit/plugin/trailing', () => ({ trailing: {} }))
vi.mock('@milkdown/kit/utils', () => ({
  $inputRule: vi.fn((factory: unknown) => ({ factory })),
  $node: vi.fn((name: string, factory: unknown) => ({ name, factory })),
  replaceAll,
  callCommand: vi.fn((key: string) => ({ key })),
  $prose: vi.fn((factory: unknown) => factory),
  $remark: vi.fn(() => ({})),
  $view: vi.fn((node: unknown, factory: unknown) => ({ node, factory })),
}))

describe('MdWysiwygEditor', () => {
  beforeEach(() => {
    editorInstances.length = 0
    editorFactory.mockClear()
    replaceAll.mockClear()
    editorControl.deferCreate = false
    editorControl.releaseCreate = null
    useEditorStore.setState({
      content: '# 完整正文\n\n最后一段',
      isDirty: false,
      editorHydrationEpoch: 0,
    })
  })

  it('creates the Markdown editor with the complete active document', async () => {
    render(<MdWysiwygEditor fileKey="note.md" onMarkdownCommit={vi.fn()} theme="light" />)

    await waitFor(() => expect(editorInstances[0]?.create).toHaveBeenCalled())
    expect(editorInstances).toHaveLength(1)
  })

  it.each([0.75, 0.94, 1, 1.5, 2.5])(
    'keeps the compensated zoom surface centered at %s',
    async (contentZoom) => {
      const { container } = render(
        <MdWysiwygEditor
          fileKey={`note-${contentZoom}.md`}
          onMarkdownCommit={vi.fn()}
          theme="light"
          contentZoom={contentZoom}
        />,
      )
      await waitFor(() => expect(editorInstances[0]?.create).toHaveBeenCalled())

      const root = container.querySelector<HTMLElement>('.flux-milkdown-root')
      expect(root?.style.width).toBe(`${100 / contentZoom}%`)
      expect(root?.style.alignSelf).toBe('center')
      expect(root?.style.left).toBe('')
      expect(root?.style.transform).toBe('')
      expect(root?.style.zoom).toBe(`${contentZoom}`)
      expect(root?.style.getPropertyValue('--content-zoom')).toBe(`${contentZoom}`)
      expect(root?.style.getPropertyValue('--font-code-size')).toBe('13px')
    },
  )

  it('hydrates content loaded before the editor finishes creating', async () => {
    editorControl.deferCreate = true
    render(<MdWysiwygEditor fileKey="external.md" onMarkdownCommit={vi.fn()} theme="light" />)
    await waitFor(() => expect(editorInstances[0]?.create).toHaveBeenCalled())

    act(() => useEditorStore.setState({ content: '# External note', editorHydrationEpoch: 1 }))
    await act(async () => {
      editorControl.releaseCreate?.()
      await Promise.resolve()
    })

    await waitFor(() => expect(replaceAll).toHaveBeenCalledWith('# External note', true))
  })

  it('commits the complete Markdown emitted after editing or Markdown paste', async () => {
    const onMarkdownCommit = vi.fn()
    render(<MdWysiwygEditor fileKey="note.md" onMarkdownCommit={onMarkdownCommit} theme="light" />)
    await waitFor(() => expect(editorInstances[0]?.markdownListener).toBeTypeOf('function'))

    act(() => useEditorStore.setState({ isDirty: true }))
    act(() => editorInstances[0]?.markdownListener?.({}, '## 粘贴标题\n\n- 项目\n- 项目二'))

    expect(onMarkdownCommit).toHaveBeenCalledWith('## 粘贴标题\n\n- 项目\n- 项目二')
  })

  it('does not mark a clean document dirty from editor initialization normalization', async () => {
    const onMarkdownCommit = vi.fn()
    render(<MdWysiwygEditor fileKey="note.md" onMarkdownCommit={onMarkdownCommit} theme="light" />)
    await waitFor(() => expect(editorInstances[0]?.markdownListener).toBeTypeOf('function'))

    act(() => editorInstances[0]?.markdownListener?.({}, '# 完整正文\n\n最后一段\n'))

    expect(onMarkdownCommit).not.toHaveBeenCalled()
  })

  it('replaces the whole document when disk hydration changes', async () => {
    render(<MdWysiwygEditor fileKey="note.md" onMarkdownCommit={vi.fn()} theme="light" />)
    await waitFor(() => expect(editorInstances[0]?.create).toHaveBeenCalled())

    act(() => useEditorStore.setState({ content: '# 外部更新', editorHydrationEpoch: 1 }))

    expect(replaceAll).toHaveBeenCalledWith('# 外部更新', true)
    expect(editorInstances[0]?.action).toHaveBeenCalledWith({ markdown: '# 外部更新' })
  })
})
