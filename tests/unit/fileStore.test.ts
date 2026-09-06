import { describe, it, expect, beforeEach, vi } from 'vitest'

// ── Mock window.electronAPI BEFORE importing fileStore ──
const mockRead = vi.fn()
const mockReadText = vi.fn()
const mockGetInfo = vi.fn()
const mockOpen = vi.fn()
const mockReadStream = vi.fn()
const mockOpenFolder = vi.fn()
const mockScanWorkspace = vi.fn()
const mockCancelWorkspaceScan = vi.fn()
const mockOnWorkspaceScan = vi.fn()
const mockWatchWorkspace = vi.fn()
const mockStopWorkspaceWatch = vi.fn()
const mockOnWorkspaceChange = vi.fn()
const mockRecordRecent = vi.fn()
const mockListSessions = vi.fn()
const mockReadWorkspaceSession = vi.fn()
const mockDiscardSource = vi.fn()
const mockConfirm = vi.fn()

vi.stubGlobal('window', {
  electronAPI: {
    file: {
      read: mockRead,
      readText: mockReadText,
      getInfo: mockGetInfo,
      open: mockOpen,
      openFolder: mockOpenFolder,
      readStream: mockReadStream,
      scanWorkspace: mockScanWorkspace,
      cancelWorkspaceScan: mockCancelWorkspaceScan,
      onWorkspaceScan: mockOnWorkspaceScan,
      watchWorkspace: mockWatchWorkspace,
      stopWorkspaceWatch: mockStopWorkspaceWatch,
      onWorkspaceChange: mockOnWorkspaceChange,
    },
    recent: { record: mockRecordRecent },
    workspace: {
      readSession: mockReadWorkspaceSession,
      session: { list: mockListSessions },
    },
    backup: { discardSource: mockDiscardSource },
  },
  confirm: mockConfirm,
})

import type { FileEntry } from '../../src/renderer/src/stores/fileStore'
import { hasDirtyDocument, useFileStore } from '../../src/renderer/src/stores/fileStore'
import { useEditorStore } from '../../src/renderer/src/stores/editorStore'
import { registerUnsavedPrompt } from '../../src/renderer/src/utils/unsavedChangesGuard'

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
      mru: [],
      isLoading: false,
      workspaceRoot: null,
      workspaceFiles: [],
      workspaceScanTaskId: null,
      workspaceScanVersion: 0,
      workspaceScanStatus: 'idle',
      workspaceScanError: null,
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
      activeDocumentPath: null,
      documentSessions: {},
    })
    vi.clearAllMocks()
    window.confirm = mockConfirm
    mockReadText.mockResolvedValue({
      success: true,
      data: {
        filePath: '/test.txt',
        content: 'content',
        encoding: 'utf8',
        lineEnding: 'lf',
        version: { mtimeMs: 1, size: 7, contentHash: 'content' },
        sampled: false,
      },
    })
    mockCancelWorkspaceScan.mockResolvedValue({ success: true, data: { cancelled: true } })
    mockWatchWorkspace.mockResolvedValue({ success: true, data: { taskId: 'watch-1' } })
    mockStopWorkspaceWatch.mockResolvedValue({ success: true, data: { stopped: true } })
    mockOnWorkspaceChange.mockReturnValue(() => undefined)
    mockRecordRecent.mockResolvedValue({ success: true })
    mockListSessions.mockResolvedValue({ success: true, data: [] })
    mockReadWorkspaceSession.mockResolvedValue({ success: true, data: null })
    mockDiscardSource.mockResolvedValue({ success: true, data: { discarded: 0 } })
    mockConfirm.mockReturnValue(true)
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
    it('requires confirmation for a dirty non-current document using its normalized session key', () => {
      const confirm = vi.fn().mockReturnValue(false)
      vi.stubGlobal('confirm', confirm)
      window.confirm = confirm
      useFileStore.getState().addFile(makeFile({ path: 'C:\\Docs\\other.txt' }))
      useFileStore.setState({ currentFile: 'C:\\Docs\\current.txt' })
      useEditorStore.setState({
        activeDocumentPath: 'c:/docs/other.txt',
        documentSessions: {
          'c:/docs/other.txt': {
            filePath: 'C:\\Docs\\other.txt',
            draft: 'changed',
            dirty: true,
            mode: 'text',
            scrollTop: 0,
            snapshot: null,
            sampled: false,
            lastActivatedAt: 0,
          },
        },
      })

      useFileStore.getState().removeFile('c:/docs/other.txt')

      expect(confirm).toHaveBeenCalledOnce()
      expect(useFileStore.getState().files).toHaveLength(1)
      expect(hasDirtyDocument('C:\\DOCS\\OTHER.TXT')).toBe(true)
    })

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

    it('does not switch away from a dirty document when confirmation is cancelled', async () => {
      useFileStore.setState({
        files: [makeFile({ path: '/a.md' }), makeFile({ path: '/b.md' })],
        currentFile: '/a.md',
      })
      useEditorStore.getState().setDocumentSnapshot('/b.md', {
        filePath: '/b.md', content: '# B', encoding: 'utf8', lineEnding: 'lf',
        version: { mtimeMs: 1, size: 3, contentHash: 'b' }, sampled: false,
      })
      useEditorStore.getState().setDocumentSnapshot('/a.md', {
        filePath: '/a.md', content: '# A', encoding: 'utf8', lineEnding: 'lf',
        version: { mtimeMs: 1, size: 3, contentHash: 'a' }, sampled: false,
      })
      useEditorStore.getState().setContent('# changed')
      const unregister = registerUnsavedPrompt(async () => 'cancel')

      useFileStore.getState().setCurrentFile('/b.md')
      await vi.waitFor(() => expect(useFileStore.getState().currentFile).toBe('/a.md'))
      expect(useEditorStore.getState().content).toBe('# changed')
      unregister()
    })

    it('discards the draft before switching when requested', async () => {
      useFileStore.setState({
        files: [makeFile({ path: '/a.md' }), makeFile({ path: '/b.md' })],
        currentFile: '/a.md',
      })
      useEditorStore.getState().setDocumentSnapshot('/b.md', {
        filePath: '/b.md', content: '# B', encoding: 'utf8', lineEnding: 'lf',
        version: { mtimeMs: 1, size: 3, contentHash: 'b' }, sampled: false,
      })
      useEditorStore.getState().setDocumentSnapshot('/a.md', {
        filePath: '/a.md', content: '# A', encoding: 'utf8', lineEnding: 'lf',
        version: { mtimeMs: 1, size: 3, contentHash: 'a' }, sampled: false,
      })
      useEditorStore.getState().setContent('# changed')
      const unregister = registerUnsavedPrompt(async () => 'discard')

      useFileStore.getState().setCurrentFile('/b.md')
      await vi.waitFor(() => expect(useFileStore.getState().currentFile).toBe('/b.md'))
      expect(useEditorStore.getState().documentSessions['/a.md']).toBeUndefined()
      expect(mockDiscardSource).toHaveBeenCalledWith('/a.md')
      unregister()
    })
  })

  describe('MRU navigation', () => {
    it('cycles forward and backward without discarding the active draft', () => {
      useFileStore.getState().addFile(makeFile({ path: '/a.txt' }))
      useFileStore.getState().addFile(makeFile({ path: '/b.txt' }))
      useFileStore.getState().addFile(makeFile({ path: '/c.txt' }))
      useFileStore.setState({ currentFile: '/a.txt', mru: ['/a.txt', '/b.txt', '/c.txt'] })

      useFileStore.getState().cycleMru(1)
      expect(useFileStore.getState().currentFile).toBe('/b.txt')

      useFileStore.getState().cycleMru(-1)
      expect(useFileStore.getState().currentFile).toBe('/a.txt')
    })
  })

  describe('openFolder', () => {
    it('keeps scan batches that arrive before the scan task id response', async () => {
      let scanListener: ((event: {
        taskId: string
        status: 'batch' | 'complete'
        entries?: Array<{ path: string; relativePath: string }>
      }) => void) | null = null
      const unsubscribe = vi.fn()
      mockOnWorkspaceScan.mockImplementation((listener) => {
        scanListener = listener
        return unsubscribe
      })
      mockOpenFolder.mockResolvedValue({
        success: true,
        data: { root: 'C:\\workspace', files: [] },
      })
      mockScanWorkspace.mockImplementation(async () => {
        scanListener?.({
          taskId: 'scan-1',
          status: 'batch',
          entries: [{ path: 'C:\\workspace\\notes.md', relativePath: 'notes.md' }],
        })
        return { success: true, data: { taskId: 'scan-1' } }
      })

      await useFileStore.getState().openFolder()

      expect(useFileStore.getState().workspaceRoot).toBe('C:\\workspace')
      expect(useFileStore.getState().workspaceFiles).toEqual([])
      expect(useFileStore.getState().workspaceScanStatus).toBe('scanning')

      scanListener?.({ taskId: 'scan-1', status: 'complete' })
      expect(useFileStore.getState().workspaceFiles).toEqual([
        { path: 'C:\\workspace\\notes.md', relativePath: 'notes.md' },
      ])
      expect(useFileStore.getState().workspaceScanStatus).toBe('complete')
      expect(unsubscribe).toHaveBeenCalledOnce()
    })

    it('keeps the existing tree visible until a rescan completes, then replaces it', async () => {
      let scanListener: ((event: {
        taskId: string
        status: 'batch' | 'complete'
        entries?: Array<{ path: string; relativePath: string }>
      }) => void) | null = null
      mockOnWorkspaceScan.mockImplementation((listener) => {
        scanListener = listener
        return vi.fn()
      })
      mockScanWorkspace.mockResolvedValue({ success: true, data: { taskId: 'scan-2' } })
      useFileStore.setState({
        workspaceRoot: 'C:\\workspace',
        workspaceFiles: [{ path: 'C:\\workspace\\old.md', relativePath: 'old.md' }],
      })

      await useFileStore.getState().startWorkspaceScan('C:\\workspace')
      scanListener?.({
        taskId: 'scan-2',
        status: 'batch',
        entries: [{ path: 'C:\\workspace\\new.md', relativePath: 'new.md' }],
      })

      expect(useFileStore.getState().workspaceFiles).toEqual([
        { path: 'C:\\workspace\\old.md', relativePath: 'old.md' },
      ])

      scanListener?.({ taskId: 'scan-2', status: 'complete' })
      expect(useFileStore.getState().workspaceFiles).toEqual([
        { path: 'C:\\workspace\\new.md', relativePath: 'new.md' },
      ])
      expect(useFileStore.getState().workspaceScanVersion).toBe(1)
    })

    it('exposes an open-folder failure in workspace scan state', async () => {
      mockOpenFolder.mockResolvedValue({ success: false, error: 'Folder dialog failed' })

      await useFileStore.getState().openFolder()

      expect(useFileStore.getState().workspaceScanStatus).toBe('error')
      expect(useFileStore.getState().workspaceScanError).toBe('Folder dialog failed')
    })

    it('rescans after the workspace watcher reports a filesystem change', async () => {
      vi.useFakeTimers()
      let changeListener: ((event: { watchId: string; root: string; changedPaths: string[] }) => void) | null = null
      mockOnWorkspaceChange.mockImplementation((listener) => {
        changeListener = listener
        return vi.fn()
      })
      mockOnWorkspaceScan.mockReturnValue(vi.fn())
      mockOpenFolder.mockResolvedValue({ success: true, data: { root: 'C:\\workspace', files: [] } })
      mockScanWorkspace.mockResolvedValue({ success: true, data: { taskId: 'scan-1' } })

      await useFileStore.getState().openFolder()
      expect(mockScanWorkspace).toHaveBeenCalledTimes(1)

      changeListener?.({ watchId: 'watch-1', root: 'C:\\workspace', changedPaths: [] })
      await vi.advanceTimersByTimeAsync(250)

      expect(mockScanWorkspace).toHaveBeenCalledTimes(2)
      vi.useRealTimers()
    })

    it('prompts and reloads the current file after an external content change', async () => {
      let changeListener: ((event: { watchId: string; root: string; changedPaths: string[] }) => void) | null = null
      mockOnWorkspaceChange.mockImplementation((listener) => {
        changeListener = listener
        return vi.fn()
      })
      mockOnWorkspaceScan.mockReturnValue(vi.fn())
      mockOpenFolder.mockResolvedValue({ success: true, data: { root: 'C:\\workspace', files: [] } })
      mockScanWorkspace.mockResolvedValue({ success: true, data: { taskId: 'scan-1' } })
      await useFileStore.getState().openFolder()

      const filePath = 'C:\\workspace\\notes.md'
      useFileStore.setState({ currentFile: filePath, files: [makeFile({ path: filePath, name: 'notes.md' })] })
      useEditorStore.getState().setDocumentSnapshot(filePath, {
        filePath, content: '# Old', encoding: 'utf8', lineEnding: 'lf',
        version: { mtimeMs: 1, size: 5, contentHash: 'old' }, sampled: false,
      })
      mockReadText.mockResolvedValueOnce({
        success: true,
        data: {
          filePath, content: '# External', encoding: 'utf8', lineEnding: 'lf',
          version: { mtimeMs: 2, size: 10, contentHash: 'external' }, sampled: false,
        },
      })

      changeListener?.({ watchId: 'watch-1', root: 'C:\\workspace', changedPaths: [filePath] })

      await vi.waitFor(() => expect(useEditorStore.getState().content).toBe('# External'))
      expect(mockConfirm).toHaveBeenCalledWith('文件已在外部修改，是否重新加载？')
      expect(useEditorStore.getState().isDirty).toBe(false)
    })
  })

  describe('clearWorkspace', () => {
    it('keeps the workspace watcher active when a dirty-document prompt is cancelled', async () => {
      const confirm = vi.fn().mockReturnValue(true)
      vi.stubGlobal('confirm', confirm)
      window.confirm = confirm
      useFileStore.setState({
        workspaceRoot: 'C:\\workspace',
        workspaceFiles: [{ path: 'C:\\workspace\\notes.md', relativePath: 'notes.md' }],
      })
      useEditorStore.getState().setDocumentSnapshot('C:\\workspace\\notes.md', {
        filePath: 'C:\\workspace\\notes.md', content: '# Notes', encoding: 'utf8', lineEnding: 'lf',
        version: { mtimeMs: 1, size: 7, contentHash: 'notes' }, sampled: false,
      })
      useEditorStore.getState().setContent('# Changed')
      const prompt = vi.fn(async () => 'cancel' as const)
      const unregister = registerUnsavedPrompt(prompt)

      useFileStore.getState().clearWorkspace()

      await vi.waitFor(() => expect(prompt).toHaveBeenCalled())
      expect(useFileStore.getState().workspaceRoot).toBe('C:\\workspace')
      expect(mockStopWorkspaceWatch).not.toHaveBeenCalled()
      unregister()
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

  describe('openFileFromLaunch', () => {
    it('keeps the current workspace when opening an external file', async () => {
      let finishRead: ((value: unknown) => void) | undefined
      mockReadText.mockImplementation(() => new Promise((resolve) => { finishRead = resolve }))
      useFileStore.setState({ workspaceRoot: 'C:\\workspace' })
      mockGetInfo.mockResolvedValue({
        success: true,
        data: {
          path: 'C:\\outside\\note.md',
          name: 'note.md',
          size: 12,
          extension: '.md',
          lines: 1,
          encoding: 'utf8',
        },
      })

      await useFileStore.getState().openFileFromLaunch('C:\\outside\\note.md')

      await vi.waitFor(() => expect(mockReadText).toHaveBeenCalledWith('C:\\outside\\note.md'))
      expect(useEditorStore.getState().content).toBe('')
      finishRead?.({
        success: true,
        data: {
          filePath: 'c:/outside/note.md',
          content: '# External note',
          encoding: 'utf8',
          lineEnding: 'lf',
          version: { mtimeMs: 1, size: 15, contentHash: 'external' },
          sampled: false,
        },
      })
      await vi.waitFor(() => expect(useEditorStore.getState().content).toBe('# External note'))

      expect(mockOpenFolder).not.toHaveBeenCalled()
      expect(useFileStore.getState().workspaceRoot).toBe('C:\\workspace')
      expect(useFileStore.getState().files.some((file) => file.path === 'C:\\outside\\note.md')).toBe(true)
    })

    it('opens a standalone file without binding its parent as a workspace', async () => {
      mockGetInfo.mockResolvedValue({
        success: true,
        data: {
          path: 'C:\\notes\\single.md',
          name: 'single.md',
          size: 8,
          extension: '.md',
          lines: 1,
          encoding: 'utf8',
        },
      })

      await useFileStore.getState().openFileFromLaunch('C:\\notes\\single.md')

      expect(mockOpenFolder).not.toHaveBeenCalled()
      expect(useFileStore.getState().workspaceRoot).toBeNull()
      expect(useFileStore.getState().currentFile).toBe('C:\\notes\\single.md')
    })
  })

  describe('loadFileContent', () => {
    it('drops a stale empty placeholder so the document can be loaded on the next activation', async () => {
      let finishFirstRead: ((value: unknown) => void) | undefined
      mockReadText
        .mockImplementationOnce(() => new Promise((resolve) => { finishFirstRead = resolve }))
        .mockResolvedValueOnce({
          success: true,
          data: {
            filePath: '/b.md', content: '# B', encoding: 'utf8', lineEnding: 'lf',
            version: { mtimeMs: 1, size: 3, contentHash: 'b' }, sampled: false,
          },
        })
        .mockResolvedValueOnce({
          success: true,
          data: {
            filePath: '/a.md', content: '# A reloaded', encoding: 'utf8', lineEnding: 'lf',
            version: { mtimeMs: 2, size: 12, contentHash: 'a2' }, sampled: false,
          },
        })
      useFileStore.setState({
        files: [makeFile({ path: '/a.md' }), makeFile({ path: '/b.md' })],
      })

      void useFileStore.getState().setCurrentFile('/a.md')
      await vi.waitFor(() => expect(mockReadText).toHaveBeenCalledWith('/a.md'))
      void useFileStore.getState().setCurrentFile('/b.md')
      await vi.waitFor(() => expect(useEditorStore.getState().content).toBe('# B'))

      finishFirstRead?.({
        success: true,
        data: {
          filePath: '/a.md', content: '# A stale', encoding: 'utf8', lineEnding: 'lf',
          version: { mtimeMs: 1, size: 9, contentHash: 'a1' }, sampled: false,
        },
      })
      await vi.waitFor(() => expect(useEditorStore.getState().documentSessions['/a.md']).toBeUndefined())

      void useFileStore.getState().setCurrentFile('/a.md')
      await vi.waitFor(() => expect(useEditorStore.getState().content).toBe('# A reloaded'))
      expect(mockReadText).toHaveBeenCalledTimes(3)
    })

    it('evicts only the oldest clean inactive sessions when the cache exceeds eight documents', async () => {
      const documentSessions = Object.fromEntries(Array.from({ length: 10 }, (_, index) => {
        const filePath = `/cached-${index}.md`
        return [filePath, {
          filePath,
          draft: `# Cached ${index}`,
          dirty: index === 0,
          mode: 'markdown-read' as const,
          scrollTop: 0,
          snapshot: {
            filePath,
            content: `# Cached ${index}`,
            encoding: 'utf8',
            lineEnding: 'lf' as const,
            version: { mtimeMs: index, size: 10, contentHash: `cached-${index}` },
            sampled: false,
          },
          sampled: false,
          lastActivatedAt: index,
        }]
      }))
      useEditorStore.setState({ documentSessions })
      useFileStore.setState({ currentFile: '/active.md' })
      useEditorStore.getState().beginDocumentLoad('/active.md')

      await useFileStore.getState().loadFileContent('/active.md', true)

      const sessions = useEditorStore.getState().documentSessions
      expect(sessions['/cached-0.md']).toBeDefined()
      expect(sessions['/cached-1.md']).toBeUndefined()
      expect(Object.keys(sessions)).toHaveLength(10)
      expect(sessions['/active.md']?.draft).toBe('content')
    })
  })
})
