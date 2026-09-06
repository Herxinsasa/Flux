import fs from 'node:fs'
import path from 'node:path'
import { act, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { MdWysiwygEditor } from '../../src/renderer/src/components/editor/MdWysiwygEditor'
import { useEditorStore } from '../../src/renderer/src/stores/editorStore'

const {
  defaultStrikeInputRule,
  preserveEmptyLinePlugins,
  editorControl,
  editorFactory,
  editorInstances,
  lifecycleEvents,
  remarkGfmOptions,
} = vi.hoisted(() => {
  const defaultStrikeInputRule = Symbol('default-single-tilde-strike-input-rule')
  const preserveEmptyLinePlugins = [
    Symbol('remark-preserve-empty-line-options'),
    Symbol('remark-preserve-empty-line-plugin'),
  ]
  const remarkGfmOptions = { key: Symbol('remark-gfm-options') }
  const lifecycleEvents: string[] = []
  const editorControl = {
    deferFirstDestroy: false,
    releaseFirstDestroy: null as (() => void) | null,
    failCreateFor: null as number | null,
  }
  const editorInstances: Array<{
    configCallbacks: Array<(ctx: unknown) => void>
    contextSet: ReturnType<typeof vi.fn>
    create: ReturnType<typeof vi.fn>
    destroy: ReturnType<typeof vi.fn>
    action: ReturnType<typeof vi.fn>
    usedPlugins: unknown[]
  }> = []
  const editorFactory = vi.fn(() => {
    const instanceIndex = editorInstances.length
    const contextSet = vi.fn()
    const instance = {
      configCallbacks: [] as Array<(ctx: unknown) => void>,
      contextSet,
      config(callback: (ctx: unknown) => void) {
        this.configCallbacks.push(callback)
        return this
      },
      use(plugin: unknown) {
        this.usedPlugins.push(plugin)
        return this
      },
      create: vi.fn(async function (this: typeof instance) {
        if (editorControl.failCreateFor === instanceIndex) {
          throw new Error(`create failed for ${instanceIndex}`)
        }
        lifecycleEvents.push(`create:${instanceIndex}`)
        const context = {
          set: contextSet,
          get: vi.fn(() => ({
            handlers: {},
            markdownUpdated: vi.fn(),
          })),
          update: vi.fn(),
        }
        this.configCallbacks.forEach((callback) => callback(context))
      }),
      destroy: vi.fn(async () => {
        lifecycleEvents.push(`destroy:${instanceIndex}:start`)
        if (instanceIndex === 0 && editorControl.deferFirstDestroy) {
          await new Promise<void>((resolve) => {
            editorControl.releaseFirstDestroy = resolve
          })
        }
        lifecycleEvents.push(`destroy:${instanceIndex}:end`)
      }),
      action: vi.fn(),
      usedPlugins: [] as unknown[],
    }
    editorInstances.push(instance)
    return instance
  })

  return {
    defaultStrikeInputRule,
    preserveEmptyLinePlugins,
    editorControl,
    editorFactory,
    editorInstances,
    lifecycleEvents,
    remarkGfmOptions,
  }
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
  commonmark: [...preserveEmptyLinePlugins, Symbol('remaining-commonmark-plugin')],
  remarkPreserveEmptyLinePlugin: preserveEmptyLinePlugins,
  wrapInBlockquoteCommand: { key: 'blockquote' },
}))
vi.mock('@milkdown/kit/preset/gfm', () => ({
  gfm: [defaultStrikeInputRule, Symbol('remaining-gfm-plugin')],
  remarkGFMPlugin: { options: remarkGfmOptions },
  strikethroughInputRule: defaultStrikeInputRule,
}))
vi.mock('@milkdown/kit/plugin/clipboard', () => ({ clipboard: {} }))
vi.mock('@milkdown/kit/plugin/history', () => ({ history: {} }))
vi.mock('@milkdown/kit/plugin/listener', () => ({ listener: {}, listenerCtx: {} }))
vi.mock('@milkdown/kit/plugin/trailing', () => ({ trailing: {} }))
vi.mock('@milkdown/kit/utils', () => ({
  $inputRule: vi.fn((factory: unknown) => ({ factory })),
  $node: vi.fn((name: string, factory: unknown) => ({ name, factory })),
  $prose: vi.fn((factory: unknown) => factory),
  $remark: vi.fn(() => ({})),
  $view: vi.fn((node: unknown, factory: unknown) => ({ node, factory })),
  callCommand: vi.fn((key: string) => ({ key })),
  replaceAll: vi.fn((markdown: string) => ({ markdown })),
}))

function flattenPlugins(plugins: unknown[]): unknown[] {
  return plugins.flatMap((plugin) => (Array.isArray(plugin) ? flattenPlugins(plugin) : [plugin]))
}

describe('MdWysiwygEditor compatibility regression baseline', () => {
  beforeEach(() => {
    editorControl.deferFirstDestroy = false
    editorControl.releaseFirstDestroy = null
    editorControl.failCreateFor = null
    editorFactory.mockClear()
    editorInstances.length = 0
    lifecycleEvents.length = 0
    useEditorStore.setState({
      content: '# 文档',
      editorHydrationEpoch: 0,
      isDirty: false,
      markdownEditSurface: 'wysiwyg',
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('disables single-tilde parsing while retaining CommonMark empty-line compatibility', async () => {
    render(<MdWysiwygEditor fileKey="syntax.md" onMarkdownCommit={vi.fn()} theme="light" />)
    await waitFor(() => expect(editorInstances[0]?.create).toHaveBeenCalled())

    const optionCall = editorInstances[0]?.contextSet.mock.calls.find(
      ([contextKey]) => contextKey === remarkGfmOptions.key,
    )
    const usedPlugins = flattenPlugins(editorInstances[0]?.usedPlugins ?? [])

    expect(optionCall?.[1]).toMatchObject({ singleTilde: false })
    expect(usedPlugins).not.toContain(defaultStrikeInputRule)
    preserveEmptyLinePlugins.forEach((plugin) => expect(usedPlugins).toContain(plugin))
  })

  it('waits for the previous editor destroy before creating the next file editor', async () => {
    editorControl.deferFirstDestroy = true
    const view = render(
      <MdWysiwygEditor fileKey="first.md" onMarkdownCommit={vi.fn()} theme="light" />,
    )
    await waitFor(() => expect(editorInstances[0]?.create).toHaveBeenCalledTimes(1))

    view.rerender(<MdWysiwygEditor fileKey="second.md" onMarkdownCommit={vi.fn()} theme="light" />)
    await waitFor(() => expect(editorControl.releaseFirstDestroy).toBeTypeOf('function'))
    await act(async () => {
      await Promise.resolve()
    })

    const nextCreateCallsBeforeDestroy = editorInstances[1]?.create.mock.calls.length ?? 0
    editorControl.releaseFirstDestroy?.()
    await waitFor(() => expect(editorInstances[1]?.create).toHaveBeenCalledTimes(1))

    expect(nextCreateCallsBeforeDestroy).toBe(0)
    expect(lifecycleEvents.indexOf('destroy:0:end')).toBeLessThan(
      lifecycleEvents.indexOf('create:1'),
    )
  })

  it('skips stale queued creates during a rapid three-file switch', async () => {
    editorControl.deferFirstDestroy = true
    const view = render(
      <MdWysiwygEditor fileKey="first.md" onMarkdownCommit={vi.fn()} theme="light" />,
    )
    await waitFor(() => expect(editorInstances[0]?.create).toHaveBeenCalledTimes(1))

    view.rerender(<MdWysiwygEditor fileKey="second.md" onMarkdownCommit={vi.fn()} theme="light" />)
    view.rerender(<MdWysiwygEditor fileKey="third.md" onMarkdownCommit={vi.fn()} theme="light" />)
    await waitFor(() => expect(editorControl.releaseFirstDestroy).toBeTypeOf('function'))

    editorControl.releaseFirstDestroy?.()
    await waitFor(() => expect(editorInstances[2]?.create).toHaveBeenCalledTimes(1))

    expect(editorInstances[1]?.create).not.toHaveBeenCalled()
    expect(editorInstances[1]?.destroy).not.toHaveBeenCalled()
    expect(lifecycleEvents).toEqual(['create:0', 'destroy:0:start', 'destroy:0:end', 'create:2'])
  })

  it('falls back to source mode and destroys a failed editor without an unhandled rejection', async () => {
    editorControl.failCreateFor = 0
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    render(<MdWysiwygEditor fileKey="broken.md" onMarkdownCommit={vi.fn()} theme="light" />)
    await waitFor(() => expect(editorInstances[0]?.create).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(useEditorStore.getState().markdownEditSurface).toBe('source'))

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('editor.create 失败 fileKey=broken.md'),
      expect.any(Error),
    )
    expect(editorInstances[0]?.destroy).toHaveBeenCalledTimes(1)
  })

  it('centers zoom without left/translate and exposes zoom to image constraints', async () => {
    const { container } = render(
      <MdWysiwygEditor
        fileKey="zoom.md"
        onMarkdownCommit={vi.fn()}
        theme="light"
        contentZoom={1.5}
      />,
    )
    await waitFor(() => expect(editorInstances[0]?.create).toHaveBeenCalled())

    const editor = container.querySelector<HTMLElement>('.flux-milkdown-editor')
    const root = container.querySelector<HTMLElement>('.flux-milkdown-root')
    const compensatedWidth = Number.parseFloat(root?.style.width ?? '0')

    expect(compensatedWidth * 1.5).toBeCloseTo(100, 5)
    expect(root?.style.left).toBe('')
    expect(root?.style.transform).toBe('')
    expect(root?.style.getPropertyValue('--content-zoom')).toBe('1.5')
    expect(editor?.dataset.zoomBelowOne).toBeUndefined()

    const cssPath = path.resolve(
      process.cwd(),
      'src/renderer/src/components/editor/MdWysiwygEditor.css',
    )
    const css = fs.readFileSync(cssPath, 'utf8')
    const imageRule = css.match(/\.flux-image-node img\s*\{([\s\S]*?)\}/)?.[1]
    expect(imageRule).toContain('max-width: 100%')
    expect(imageRule).not.toContain('var(--content-zoom, 1)')

    const wrapperRule = css.match(/\.flux-image-node\s*\{([\s\S]*?)\}/)?.[1]
    expect(wrapperRule).toContain('max-width: calc(100% * var(--content-zoom, 1))')
  })
})
