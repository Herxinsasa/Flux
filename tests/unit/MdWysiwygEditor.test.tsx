import { act, render, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { MdWysiwygEditor } from '../../src/renderer/src/components/editor/MdWysiwygEditor'
import { useEditorStore } from '../../src/renderer/src/stores/editorStore'

const { replaceAll, editorInstances, editorFactory } = vi.hoisted(() => {
  const replaceAll = vi.fn((markdown: string) => ({ markdown }))
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
      config(callback: (ctx: unknown) => void) { this.configCallbacks.push(callback); return this },
      use() { return this },
      create: vi.fn(async function (this: typeof instance) {
        const ctx = {
          set: vi.fn(),
          get: vi.fn(() => ({ markdownUpdated: (callback: typeof instance.markdownListener) => { instance.markdownListener = callback }, handlers: {} })),
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
  return { replaceAll, editorInstances, editorFactory }
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
vi.mock('@milkdown/kit/preset/commonmark', () => ({ commonmark: {}, wrapInBlockquoteCommand: { key: 'blockquote' } }))
vi.mock('@milkdown/kit/preset/gfm', () => ({ gfm: {} }))
vi.mock('@milkdown/kit/plugin/clipboard', () => ({ clipboard: {} }))
vi.mock('@milkdown/kit/plugin/history', () => ({ history: {} }))
vi.mock('@milkdown/kit/plugin/listener', () => ({ listener: {}, listenerCtx: {} }))
vi.mock('@milkdown/kit/plugin/trailing', () => ({ trailing: {} }))
vi.mock('@milkdown/kit/utils', () => ({
  replaceAll,
  callCommand: vi.fn((key: string) => ({ key })),
  $prose: vi.fn((factory: unknown) => factory),
  $remark: vi.fn(() => ({})),
}))

describe('MdWysiwygEditor', () => {
  beforeEach(() => {
    editorInstances.length = 0
    editorFactory.mockClear()
    replaceAll.mockClear()
    useEditorStore.setState({ content: '# 完整正文\n\n最后一段', isDirty: false, editorHydrationEpoch: 0 })
  })

  it('creates the Markdown editor with the complete active document', async () => {
    render(<MdWysiwygEditor fileKey="note.md" onMarkdownCommit={vi.fn()} theme="light" />)

    await waitFor(() => expect(editorInstances[0]?.create).toHaveBeenCalled())
    expect(editorInstances).toHaveLength(1)
  })

  it('centers the zoomed editing surface and scales code with the document', async () => {
    const { container } = render(<MdWysiwygEditor fileKey="note.md" onMarkdownCommit={vi.fn()} theme="light" contentZoom={2} />)
    await waitFor(() => expect(editorInstances[0]?.create).toHaveBeenCalled())

    const root = container.querySelector<HTMLElement>('.flux-milkdown-root')
    expect(root?.style.width).toBe('50%')
    expect(root?.style.left).toBe('50%')
    expect(root?.style.transform).toBe('translateX(-50%)')
    expect(root?.style.getPropertyValue('--font-code-size')).toBe('13px')
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
