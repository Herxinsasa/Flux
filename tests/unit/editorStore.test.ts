import { describe, it, expect, beforeEach } from 'vitest'

// Import builtinModes to populate the editor mode registry (side-effect import)
import '../../src/renderer/src/registry/builtinModes'

import { inferMode, useEditorStore } from '../../src/renderer/src/stores/editorStore'
import type { EditorMode } from '../../src/renderer/src/stores/editorStore'

describe('inferMode', () => {
  it("infers 'markdown' for .md extension", () => {
    expect(inferMode('.md')).toBe('markdown')
  })

  it("infers 'markdown' for .markdown extension", () => {
    expect(inferMode('.markdown')).toBe('markdown')
  })

  it("infers 'json' for .json extension", () => {
    expect(inferMode('.json')).toBe('json')
  })

  it("infers 'log' for .log extension", () => {
    expect(inferMode('.log')).toBe('log')
  })

  it("infers 'text' for .txt extension", () => {
    expect(inferMode('.txt')).toBe('text')
  })

  it("falls back to 'text' for unknown extensions", () => {
    expect(inferMode('.xyz')).toBe('text')
  })

  it('works with full file paths', () => {
    expect(inferMode('/path/to/readme.md')).toBe('markdown')
    expect(inferMode('C:\\data\\config.json')).toBe('json')
  })

  it('works with extension without leading dot', () => {
    expect(inferMode('md')).toBe('text') // "md" is not a registered extension
  })
})

describe('useEditorStore', () => {
  beforeEach(() => {
    // Reset store state between tests
    useEditorStore.setState({
      mode: 'text',
      content: '',
      cursorLine: 0,
      cursorColumn: 0,
      selectedText: null,
      previewContent: null,
      isDirty: false,
      menuUiTick: 0,
      menuAction: null,
      markdownCommandTick: 0,
      markdownCommand: null,
      jumpOutlineTick: 0,
      jumpOutlineLine: 0,
      markdownEditSurface: 'wysiwyg',
      activeDocumentPath: null,
      documentSessions: {},
    })
  })

  describe('setMode', () => {
    it('accepts an EditorMode directly ("text")', () => {
      useEditorStore.getState().setMode('text')
      expect(useEditorStore.getState().mode).toBe('text')
    })

    it('accepts an EditorMode directly ("json")', () => {
      useEditorStore.getState().setMode('json')
      expect(useEditorStore.getState().mode).toBe('json')
    })

    it('accepts an EditorMode directly ("markdown")', () => {
      useEditorStore.getState().setMode('markdown')
      expect(useEditorStore.getState().mode).toBe('markdown')
    })

    it('accepts an EditorMode directly ("log")', () => {
      useEditorStore.getState().setMode('log')
      expect(useEditorStore.getState().mode).toBe('log')
    })

    it('infers mode from a file extension string', () => {
      useEditorStore.getState().setMode('.md')
      expect(useEditorStore.getState().mode).toBe('markdown')
    })

    it('infers mode from a file path', () => {
      useEditorStore.getState().setMode('/some/path/config.json')
      expect(useEditorStore.getState().mode).toBe('json')
    })

    it('falls back to text for unknown extension', () => {
      useEditorStore.getState().setMode('file.unknown')
      expect(useEditorStore.getState().mode).toBe('text')
    })
  })

  describe('setContent', () => {
    it('sets content and marks isDirty=true', () => {
      useEditorStore.getState().setContent('hello')
      expect(useEditorStore.getState().content).toBe('hello')
      expect(useEditorStore.getState().isDirty).toBe(true)
    })

    it('always sets isDirty=true even if content is the same', () => {
      useEditorStore.getState().setContent('abc')
      useEditorStore.getState().markClean()
      expect(useEditorStore.getState().isDirty).toBe(false)

      useEditorStore.getState().setContent('abc')
      expect(useEditorStore.getState().isDirty).toBe(true)
    })
  })

  describe('setDocumentSnapshot', () => {
    it('opens a normal Markdown document in the live WYSIWYG surface', () => {
      useEditorStore.getState().setDocumentSnapshot('C:\\docs\\readme.md', {
        filePath: 'C:\\docs\\readme.md',
        content: '# Flux',
        encoding: 'utf8',
        lineEnding: 'lf',
        version: { mtimeMs: 1, size: 6, contentHash: 'hash' },
        sampled: false,
      })

      const state = useEditorStore.getState()
      expect(state.mode).toBe('markdown')
      expect(state.markdownEditSurface).toBe('wysiwyg')
      expect(state.content).toBe('# Flux')
      expect(state.isDirty).toBe(false)
    })
  })

  describe('Markdown edit surface', () => {
    it('toggles only between live editing and source', () => {
      useEditorStore.getState().toggleMarkdownEditSurface()
      expect(useEditorStore.getState().markdownEditSurface).toBe('source')

      useEditorStore.getState().toggleMarkdownEditSurface()
      expect(useEditorStore.getState().markdownEditSurface).toBe('wysiwyg')
    })

    it('restores a legacy split session in source mode', () => {
      useEditorStore.setState({
        documentSessions: {
          'c:/docs/legacy.md': {
            filePath: 'C:\\docs\\legacy.md',
            draft: '# Legacy',
            dirty: false,
            mode: 'markdown-split',
            scrollTop: 0,
            snapshot: null,
            sampled: false,
            lastActivatedAt: 1,
          },
        },
      })

      expect(useEditorStore.getState().activateDocument('C:\\docs\\legacy.md')).toBe(true)
      expect(useEditorStore.getState().markdownEditSurface).toBe('source')
    })
  })

  describe('markClean', () => {
    it('sets isDirty=false', () => {
      useEditorStore.getState().setContent('dirty content')
      expect(useEditorStore.getState().isDirty).toBe(true)

      useEditorStore.getState().markClean()
      expect(useEditorStore.getState().isDirty).toBe(false)
    })
  })

  describe('discardDocumentChanges', () => {
    it('restores the disk snapshot and hydrates the active editor', () => {
      useEditorStore.getState().setDocumentSnapshot('C:\\docs\\note.md', {
        filePath: 'C:\\docs\\note.md',
        content: '# saved',
        encoding: 'utf8',
        lineEnding: 'lf',
        version: { mtimeMs: 1, size: 7, contentHash: 'saved' },
        sampled: false,
      })
      useEditorStore.getState().setContent('# changed')
      const epoch = useEditorStore.getState().editorHydrationEpoch

      useEditorStore.getState().discardDocumentChanges('c:/DOCS/note.md')

      expect(useEditorStore.getState().content).toBe('# saved')
      expect(useEditorStore.getState().isDirty).toBe(false)
      expect(useEditorStore.getState().editorHydrationEpoch).toBe(epoch + 1)
    })
  })

  describe('cursor state', () => {
    it('setCursorLine updates cursorLine', () => {
      useEditorStore.getState().setCursorLine(42)
      expect(useEditorStore.getState().cursorLine).toBe(42)
    })

    it('setCursorColumn updates cursorColumn', () => {
      useEditorStore.getState().setCursorColumn(10)
      expect(useEditorStore.getState().cursorColumn).toBe(10)
    })
  })

  describe('selectedText', () => {
    it('setSelectedText updates selectedText', () => {
      useEditorStore.getState().setSelectedText('selected portion')
      expect(useEditorStore.getState().selectedText).toBe('selected portion')
    })

    it('setSelectedText(null) clears selection', () => {
      useEditorStore.getState().setSelectedText('some text')
      useEditorStore.getState().setSelectedText(null)
      expect(useEditorStore.getState().selectedText).toBeNull()
    })
  })

  describe('previewContent', () => {
    it('setPreviewContent updates previewContent', () => {
      useEditorStore.getState().setPreviewContent('<h1>Preview</h1>')
      expect(useEditorStore.getState().previewContent).toBe('<h1>Preview</h1>')
    })

    it('setPreviewContent(null) clears preview', () => {
      useEditorStore.getState().setPreviewContent('<p>temp</p>')
      useEditorStore.getState().setPreviewContent(null)
      expect(useEditorStore.getState().previewContent).toBeNull()
    })
  })
})
