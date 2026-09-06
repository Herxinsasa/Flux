import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

const { sourceScrollDOM } = vi.hoisted(() => ({
  sourceScrollDOM: {
    scrollTop: 0,
    scrollHeight: 1000,
    clientHeight: 100,
  },
}))

vi.mock('../../src/renderer/src/components/editor/EditorPane', () => ({
  EditorPane: ({
    onEditorViewChange,
  }: {
    onEditorViewChange?: (view: { scrollDOM: typeof sourceScrollDOM }) => void
  }) => {
    onEditorViewChange?.({ scrollDOM: sourceScrollDOM })
    return <div data-testid="source-editor" />
  },
}))

vi.mock('../../src/renderer/src/components/editor/MdWysiwygEditor', () => ({
  MdWysiwygEditor: () => <div data-testid="live-editor" />,
}))

vi.mock('../../src/renderer/src/components/editor/MdOutlinePanel', () => ({
  MdOutlinePanel: () => <div data-testid="outline" />,
}))

import { MarkdownEditor } from '../../src/renderer/src/components/editor/MarkdownEditor'
import { useEditorStore } from '../../src/renderer/src/stores/editorStore'

describe('MarkdownEditor modes and outline', () => {
  beforeEach(() => {
    sourceScrollDOM.scrollTop = 0
    sourceScrollDOM.scrollHeight = 1000
    sourceScrollDOM.clientHeight = 100
    useEditorStore.setState({
      mode: 'markdown',
      content: '# Flux',
      markdownEditSurface: 'wysiwyg',
      activeDocumentPath: 'c:/notes/flux.md',
      documentSessions: {
        'c:/notes/flux.md': {
          filePath: 'C:\\notes\\flux.md',
          draft: '# Flux',
          dirty: false,
          mode: 'markdown-read',
          scrollTop: 0,
          scrollRatio: 0,
          snapshot: null,
          sampled: false,
          lastActivatedAt: 1,
          editGeneration: 0,
        },
      },
    })
  })

  afterEach(cleanup)

  it('offers only editing and source modes', () => {
    render(<MarkdownEditor />)

    expect(screen.getByRole('button', { name: '编辑' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '源码' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: '分栏' })).toBeNull()
    expect(screen.getByTestId('live-editor')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '源码' }))
    expect(screen.getByTestId('source-editor')).toBeTruthy()
  })

  it('mounts the outline before the editing surface', () => {
    render(<MarkdownEditor />)
    fireEvent.click(screen.getByRole('button', { name: '大纲' }))

    const outline = screen.getByTestId('outline').parentElement
    const editor = screen.getByTestId('live-editor')
    expect(outline).not.toBeNull()
    expect(outline?.compareDocumentPosition(editor) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('synchronously hands off scroll progress in both surface directions', () => {
    const { container } = render(<MarkdownEditor />)
    const wysiwygScroller = container.querySelector<HTMLElement>('.flux-scroll')
    expect(wysiwygScroller).not.toBeNull()
    Object.defineProperties(wysiwygScroller, {
      scrollTop: { value: 900, writable: true, configurable: true },
      scrollHeight: { value: 1000, configurable: true },
      clientHeight: { value: 100, configurable: true },
    })

    fireEvent.click(screen.getByRole('button', { name: '源码' }))
    expect(useEditorStore.getState().documentSessions['c:/notes/flux.md']?.scrollRatio).toBe(1)

    sourceScrollDOM.scrollTop = 450
    fireEvent.click(screen.getByRole('button', { name: '编辑' }))
    expect(useEditorStore.getState().documentSessions['c:/notes/flux.md']?.scrollRatio).toBe(0.5)
  })
})
