import { describe, it, expect, beforeEach, vi } from 'vitest'

// ── Mock window.electronAPI BEFORE importing fileStore ──
const mockRead = vi.fn()
const mockGetInfo = vi.fn()
const mockOpen = vi.fn()
const mockReadStream = vi.fn()
const mockOpenFolder = vi.fn()

vi.stubGlobal('window', {
  electronAPI: {
    file: {
      read: mockRead,
      getInfo: mockGetInfo,
      open: mockOpen,
      openFolder: mockOpenFolder,
      readStream: mockReadStream,
    },
  },
})

import type { FileEntry } from '../../src/renderer/src/stores/fileStore'
import { useFileStore } from '../../src/renderer/src/stores/fileStore'
import { useEditorStore } from '../../src/renderer/src/stores/editorStore'

function makeFile(overrides: Partial<FileEntry> = {}): FileEntry {
  return {
    path: '/default/path.txt',
    name: 'path.txt',
    size: 100,
    extension: '.txt',
    lines: 10,
    encoding: 'utf-8',
    active: false,
    ...overrides,
  }
}

describe('useFileStore', () => {
  beforeEach(() => {
    useFileStore.setState({
      files: [],
      currentFile: null,
      isLoading: false,
      workspaceRoot: null,
      workspaceFiles: [],
    })
    // Reset editorStore too since fileStore may interact with it
    useEditorStore.setState({
      mode: 'text',
      content: '',
      isDirty: false,
      cursorLine: 0,
      cursorColumn: 0,
      selectedText: null,
      previewContent: null,
    })
    vi.clearAllMocks()
  })

  describe('addFile', () => {
    it('appends a file when list is empty', () => {
      const file = makeFile({ path: '/a.txt', name: 'a.txt' })
      useFileStore.getState().addFile(file)
      expect(useFileStore.getState().files).toHaveLength(1)
      expect(useFileStore.getState().files[0].path).toBe('/a.txt')
    })

    it('appends without duplicating — replaces existing file with same path', () => {
      const file1 = makeFile({ path: '/a.txt', name: 'a.txt' })
      const file2 = makeFile({ path: '/a.txt', name: 'a-renamed.txt', size: 200 })
      useFileStore.getState().addFile(file1)
      useFileStore.getState().addFile(file2)
      expect(useFileStore.getState().files).toHaveLength(1)
      expect(useFileStore.getState().files[0].name).toBe('a-renamed.txt')
      expect(useFileStore.getState().files[0].size).toBe(200)
    })

    it('can hold multiple distinct files', () => {
      useFileStore.getState().addFile(makeFile({ path: '/a.txt', name: 'a.txt' }))
      useFileStore.getState().addFile(makeFile({ path: '/b.json', name: 'b.json' }))
      useFileStore.getState().addFile(makeFile({ path: '/c.md', name: 'c.md' }))
      expect(useFileStore.getState().files).toHaveLength(3)
    })
  })

  describe('removeFile', () => {
    it('removes a file by path', () => {
      useFileStore.getState().addFile(makeFile({ path: '/a.txt' }))
      useFileStore.getState().addFile(makeFile({ path: '/b.json' }))
      useFileStore.getState().removeFile('/a.txt')
      expect(useFileStore.getState().files).toHaveLength(1)
      expect(useFileStore.getState().files[0].path).toBe('/b.json')
    })

    it('clears currentFile when the removed file was current and no other files exist', () => {
      useFileStore.getState().addFile(makeFile({ path: '/only.txt' }))
      useFileStore.setState({ currentFile: '/only.txt' })
      useFileStore.getState().removeFile('/only.txt')

      expect(useFileStore.getState().files).toHaveLength(0)
      expect(useFileStore.getState().currentFile).toBeNull()
    })

    it('auto-selects next file when current file is removed', () => {
      // Setup: add files, then set current via setCurrentFile bypassing IPC
      useFileStore.getState().addFile(makeFile({ path: '/first.txt' }))
      useFileStore.getState().addFile(makeFile({ path: '/second.txt' }))
      // Directly set currentFile and active flags without triggering IPC
      useFileStore.setState({
        currentFile: '/first.txt',
        files: useFileStore.getState().files.map((f) => ({
          ...f,
          active: f.path === '/first.txt',
        })),
      })

      // Mock read for the auto-load that removeFile triggers
      mockRead.mockResolvedValue({
        success: true,
        data: { content: 'second content' },
      })

      useFileStore.getState().removeFile('/first.txt')
      expect(useFileStore.getState().currentFile).toBe('/second.txt')
      expect(useFileStore.getState().files).toHaveLength(1)
    })

    it('does nothing when removing a file that does not exist', () => {
      useFileStore.getState().addFile(makeFile({ path: '/a.txt' }))
      useFileStore.getState().removeFile('/nonexistent.txt')
      expect(useFileStore.getState().files).toHaveLength(1)
    })
  })

  describe('setCurrentFile', () => {
    it('sets currentFile to null when given null', () => {
      useFileStore.getState().addFile(makeFile({ path: '/a.txt' }))
      useFileStore.setState({
        currentFile: '/a.txt',
        files: useFileStore.getState().files.map((f) => ({ ...f, active: true })),
      })
      useFileStore.getState().setCurrentFile(null)
      expect(useFileStore.getState().currentFile).toBeNull()
    })
  })

  describe('setLoading', () => {
    it('sets isLoading flag', () => {
      useFileStore.getState().setLoading(true)
      expect(useFileStore.getState().isLoading).toBe(true)

      useFileStore.getState().setLoading(false)
      expect(useFileStore.getState().isLoading).toBe(false)
    })
  })
})
