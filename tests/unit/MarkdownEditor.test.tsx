import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

vi.mock('../../src/renderer/src/components/editor/EditorPane', () => ({
  EditorPane: () => <div data-testid="source-editor" />,
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
    useEditorStore.setState({
      mode: 'markdown',
      content: '# Flux',
      markdownEditSurface: 'wysiwyg',
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
})
