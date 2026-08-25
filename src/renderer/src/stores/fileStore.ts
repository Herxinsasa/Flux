import { create } from 'zustand'
import { useEditorStore, inferMode, normalizeDocumentPath } from './editorStore'
import { useChatStore } from './chatStore'
import { useSessionContextStore } from './sessionContextStore'
import type {
  LogIndexTaskEvent,
  TextDocumentSnapshot,
  WorkspaceFileEntry,
  WorkspaceChangeEvent,
  WorkspaceScanEvent,
} from '../../../shared/types'
import { EDITOR_LARGE_FILE_BYTES, EDITOR_SAMPLE_LINES } from '../../../shared/context-budget'
import { confirmUnsavedDocument, listDirtyDocumentPaths } from '../utils/unsavedChangesGuard'

/** Track in-flight loads to prevent concurrent loadContent calls for the same file. */
const _loadingPaths = new Set<string>()
/** Active renderer-side stream subscriptions keyed by file path. */
const _streamUnsubs = new Map<string, () => void>()
let _workspaceScanUnsub: (() => void) | null = null
let _workspaceWatchUnsub: (() => void) | null = null
let _workspaceWatchId: string | null = null
let _workspaceRefreshTimer: number | null = null
let _logIndexUnsub: (() => void) | null = null
let _logIndexRequestVersion = 0
let _navigationRequestVersion = 0

function mergeWorkspaceEntries(
  current: WorkspaceFileEntry[],
  entries: WorkspaceFileEntry[],
): WorkspaceFileEntry[] {
  const byPath = new Map(current.map((entry) => [entry.path, entry]))
  for (const entry of entries) byPath.set(entry.path, entry)
  return [...byPath.values()].sort((a, b) => a.relativePath.localeCompare(b.relativePath, undefined, { sensitivity: 'base' }))
}

function stopWorkspaceWatch(): void {
  if (_workspaceRefreshTimer != null) globalThis.clearTimeout(_workspaceRefreshTimer)
  _workspaceRefreshTimer = null
  _workspaceWatchUnsub?.()
  _workspaceWatchUnsub = null
  if (_workspaceWatchId) void window.electronAPI.file.stopWorkspaceWatch(_workspaceWatchId)
  _workspaceWatchId = null
}

async function beginWorkspaceWatch(root: string, get: () => FileState): Promise<void> {
  stopWorkspaceWatch()
  const queued: WorkspaceChangeEvent[] = []
  const applyChange = (event: WorkspaceChangeEvent) => {
    if (event.root !== root || get().workspaceRoot !== root) return
    if (_workspaceWatchId && event.watchId !== _workspaceWatchId) return
    if (_workspaceRefreshTimer != null) globalThis.clearTimeout(_workspaceRefreshTimer)
    _workspaceRefreshTimer = globalThis.setTimeout(() => {
      _workspaceRefreshTimer = null
      if (get().workspaceRoot === root) void get().startWorkspaceScan(root)
    }, 250)
  }
  const unsubscribe = window.electronAPI.file.onWorkspaceChange((event) => {
    if (_workspaceWatchId) applyChange(event)
    else queued.push(event)
  })
  _workspaceWatchUnsub = unsubscribe
  const response = await window.electronAPI.file.watchWorkspace(root)
  if (!response.success || !response.data || get().workspaceRoot !== root) {
    unsubscribe()
    if (_workspaceWatchUnsub === unsubscribe) _workspaceWatchUnsub = null
    if (response.data) void window.electronAPI.file.stopWorkspaceWatch(response.data.taskId)
    return
  }
  _workspaceWatchId = response.data.taskId
  queued.forEach(applyChange)
}

export interface FileEntry {
  path: string
  name: string
  size: number
  extension: string
  lines: number
  encoding: string
  active: boolean
}

export function hasDirtyDocument(filePath: string): boolean {
  const key = normalizeDocumentPath(filePath)
  return useEditorStore.getState().documentSessions[key]?.dirty === true
}

function formatLargeFileEditorBanner(sizeBytes: number, lines?: number): string {
  const sizeMb = (sizeBytes / (1024 * 1024)).toFixed(1)
  const lineLabel = lines != null ? lines.toLocaleString() : '?'
  return `[Flux 大文件预览] ${sizeMb} MB，约 ${lineLabel} 行。编辑器仅展示前 ${EDITOR_SAMPLE_LINES.toLocaleString()} 行采样；请通过 AI 使用 search_content / read_file(offset, limit) 分段分析。\n\n`
}

function readFileLineSample(filePath: string, maxLines: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const lines: string[] = []
    let carry = ''
    const unsub = window.electronAPI.file.readStream(filePath, (chunk) => {
      if (chunk && typeof chunk === 'object') {
        unsub()
        reject(new Error('readStream failed'))
        return
      }
      if (chunk === null) {
        unsub()
        if (carry.length > 0 && lines.length < maxLines) lines.push(carry)
        resolve(lines.join('\n'))
        return
      }
      if (typeof chunk !== 'string') return

      carry += chunk
      let nl = carry.indexOf('\n')
      while (nl !== -1 && lines.length < maxLines) {
        lines.push(carry.slice(0, nl))
        carry = carry.slice(nl + 1)
        nl = carry.indexOf('\n')
      }
      if (lines.length >= maxLines) {
        unsub()
        resolve(lines.join('\n'))
      }
    })
  })
}

interface FileState {
  files: FileEntry[]
  currentFile: string | null
  /** Most-recently-used document order, newest first. */
  mru: string[]
  isLoading: boolean
  /** 当前打开的工作区根路径（打开文件夹） */
  workspaceRoot: string | null
  /** 工作区内扫描到的文件列表 */
  workspaceFiles: WorkspaceFileEntry[]
  workspaceScanTaskId: string | null
  workspaceScanVersion: number
  workspaceScanStatus: 'idle' | 'scanning' | 'complete' | 'cancelled' | 'error'
  workspaceScanError: string | null
  /** 主动刷新工作区文件夹内容 */
  refreshWorkspaceFiles: () => Promise<void>
  startWorkspaceScan: (root: string) => Promise<void>
  cancelWorkspaceScan: () => void
  logIndexTaskId: string | null
  logIndexStatus: 'idle' | 'indexing' | 'complete' | 'cancelled' | 'error'
  logIndexError: string | null
  startLogIndex: (filePath: string) => Promise<void>
  cancelLogIndex: () => void
  addFile: (file: FileEntry) => void
  removeFile: (path: string) => void
  setCurrentFile: (path: string | null, preserveMru?: boolean) => Promise<boolean>
  cycleMru: (direction: 1 | -1) => void
  setLoading: (loading: boolean) => void
  openFile: (filePath?: string) => Promise<void>
  /** 双击文档启动：先确保文件所在目录为工作区，再打开该文档 */
  openFileFromLaunch: (filePath: string) => Promise<void>
  createFile: () => Promise<void>
  openFolder: (root?: string) => Promise<void>
  clearWorkspace: () => void
  /** 从工作区列表打开文件（必要时加入已打开列表） */
  openWorkspaceFile: (filePath: string) => Promise<void>
  /** 打开 Markdown 链接：关闭来源文件并切换到目标文件 */
  openLinkedMarkdown: (targetPath: string, replacePath: string) => Promise<void>
  loadFileContent: (filePath: string, force?: boolean) => Promise<void>
}

export const useFileStore = create<FileState>((set, get) => ({
    refreshWorkspaceFiles: async () => {
      const { workspaceRoot } = get()
      if (!workspaceRoot) return
      await get().startWorkspaceScan(workspaceRoot)
    },
  startWorkspaceScan: async (root) => {
    get().cancelWorkspaceScan()
    _workspaceScanUnsub?.()

    let taskId: string | null = null
    let scanVersion = 0
    const queued: WorkspaceScanEvent[] = []
    const applyEvent = (event: WorkspaceScanEvent) => {
      if (event.taskId !== taskId || get().workspaceRoot !== root || get().workspaceScanVersion !== scanVersion) return
      if (event.status === 'batch' && event.entries) {
        set((state) => ({ workspaceFiles: mergeWorkspaceEntries(state.workspaceFiles, event.entries!) }))
        return
      }
      if (event.status === 'complete') {
        set({ workspaceScanTaskId: null, workspaceScanStatus: 'complete', workspaceScanError: null })
      } else if (event.status === 'cancelled') {
        set({ workspaceScanTaskId: null, workspaceScanStatus: 'cancelled' })
      } else if (event.status === 'error') {
        set({ workspaceScanTaskId: null, workspaceScanStatus: 'error', workspaceScanError: event.error ?? 'Workspace scan failed' })
      }
      if (_workspaceScanUnsub === unsubscribe) _workspaceScanUnsub = null
      unsubscribe()
    }

    const unsubscribe = window.electronAPI.file.onWorkspaceScan((event) => {
      if (taskId) applyEvent(event)
      else queued.push(event)
    })
    _workspaceScanUnsub = unsubscribe
    set((state) => ({
      workspaceFiles: [],
      workspaceScanTaskId: null,
      workspaceScanVersion: state.workspaceScanVersion + 1,
      workspaceScanStatus: 'scanning',
      workspaceScanError: null,
    }))
    scanVersion = get().workspaceScanVersion
    const response = await window.electronAPI.file.scanWorkspace(root)
    if (!response.success || !response.data || get().workspaceRoot !== root || get().workspaceScanVersion !== scanVersion) {
      if (response.data) void window.electronAPI.file.cancelWorkspaceScan(response.data.taskId)
      if (_workspaceScanUnsub === unsubscribe) {
        _workspaceScanUnsub = null
        unsubscribe()
      }
      if (get().workspaceRoot === root && get().workspaceScanVersion === scanVersion) {
        set({ workspaceScanStatus: 'error', workspaceScanError: response.error ?? 'Workspace scan failed' })
      }
      return
    }
    taskId = response.data.taskId
    set({ workspaceScanTaskId: taskId })
    queued.forEach(applyEvent)
  },
  cancelWorkspaceScan: () => {
    const taskId = get().workspaceScanTaskId
    if (taskId) void window.electronAPI.file.cancelWorkspaceScan(taskId)
    _workspaceScanUnsub?.()
    _workspaceScanUnsub = null
    set({ workspaceScanTaskId: null, workspaceScanStatus: taskId ? 'cancelled' : 'idle' })
  },
  startLogIndex: async (filePath) => {
    get().cancelLogIndex()
    _logIndexUnsub?.()

    let taskId: string | null = null
    const requestVersion = ++_logIndexRequestVersion
    const queued: LogIndexTaskEvent[] = []
    const applyEvent = (event: LogIndexTaskEvent) => {
      if (event.taskId !== taskId || get().currentFile !== filePath || requestVersion !== _logIndexRequestVersion) return
      if (event.status === 'progress') return
      if (event.status === 'complete' && event.data) {
        useEditorStore.getState().setLogIndexedView(filePath, event.data.totalLines)
        set({ logIndexTaskId: null, logIndexStatus: 'complete', logIndexError: null })
      } else if (event.status === 'cancelled') {
        set({ logIndexTaskId: null, logIndexStatus: 'cancelled' })
      } else if (event.status === 'error') {
        set({ logIndexTaskId: null, logIndexStatus: 'error', logIndexError: event.error ?? 'Log indexing failed' })
      }
      if (_logIndexUnsub === unsubscribe) _logIndexUnsub = null
      unsubscribe()
    }

    const unsubscribe = window.electronAPI.log.onIndex((event) => {
      if (taskId) applyEvent(event)
      else queued.push(event)
    })
    _logIndexUnsub = unsubscribe
    set({ logIndexTaskId: null, logIndexStatus: 'indexing', logIndexError: null })
    const response = await window.electronAPI.log.index(filePath)
    if (!response.success || !response.data || get().currentFile !== filePath || requestVersion !== _logIndexRequestVersion) {
      if (response.data) void window.electronAPI.log.cancelIndex(response.data.taskId)
      if (_logIndexUnsub === unsubscribe) {
        _logIndexUnsub = null
        unsubscribe()
      }
      if (get().currentFile === filePath && requestVersion === _logIndexRequestVersion) {
        set({ logIndexStatus: 'error', logIndexError: response.error ?? 'Log indexing failed' })
      }
      return
    }
    taskId = response.data.taskId
    set({ logIndexTaskId: taskId })
    queued.forEach(applyEvent)
  },
  cancelLogIndex: () => {
    _logIndexRequestVersion++
    const taskId = get().logIndexTaskId
    if (taskId) void window.electronAPI.log.cancelIndex(taskId)
    _logIndexUnsub?.()
    _logIndexUnsub = null
    set({ logIndexTaskId: null, logIndexStatus: taskId ? 'cancelled' : 'idle', logIndexError: null })
  },
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
  logIndexTaskId: null,
  logIndexStatus: 'idle',
  logIndexError: null,

  addFile: (file) =>
    set((state) => ({
      files: [
        ...state.files.filter((f) => normalizeDocumentPath(f.path) !== normalizeDocumentPath(file.path)),
        { ...file, active: false },
      ],
    })),

  removeFile: (path) => {
    const remove = () => {
      const state = get()
      const key = normalizeDocumentPath(path)
      const newFiles = state.files.filter((f) => normalizeDocumentPath(f.path) !== key)
      const wasCurrent = state.currentFile != null && normalizeDocumentPath(state.currentFile) === key
      const newMru = state.mru.filter((item) => normalizeDocumentPath(item) !== key)
      const newCurrent = wasCurrent
        ? (newMru.find((item) => newFiles.some((file) => normalizeDocumentPath(file.path) === normalizeDocumentPath(item))) ?? newFiles[0]?.path ?? null)
        : state.currentFile

      set({ files: newFiles, currentFile: newCurrent, mru: newMru })
      useEditorStore.getState().removeDocument(path)
      if (wasCurrent && newCurrent) get().setCurrentFile(newCurrent)
    }

    if (!hasDirtyDocument(path)) {
      remove()
      return
    }
    void confirmUnsavedDocument(path).then((confirmed) => {
      if (confirmed) remove()
    })
  },

  setCurrentFile: (path, preserveMru = false) => {
    const current = get().currentFile
    if (path && current && normalizeDocumentPath(path) === normalizeDocumentPath(current)) {
      if (!useEditorStore.getState().activateDocument(path)) {
        useEditorStore.getState().beginDocumentLoad(path)
        void get().loadFileContent(path, true)
      }
      return Promise.resolve(true)
    }

    const activate = (): boolean => {
      if (!path) {
        set((state) => ({ currentFile: null, files: state.files.map((file) => ({ ...file, active: false })) }))
        return true
      }
      set((state) => ({
        currentFile: path,
        files: state.files.map((f) => ({ ...f, active: normalizeDocumentPath(f.path) === normalizeDocumentPath(path) })),
        mru: preserveMru
          ? state.mru
          : [path, ...state.mru.filter((item) => normalizeDocumentPath(item) !== normalizeDocumentPath(path))],
      }))
      if (!useEditorStore.getState().activateDocument(path)) {
        useEditorStore.getState().beginDocumentLoad(path)
        void get().loadFileContent(path, true)
      }
      return true
    }

    const activeSession = useEditorStore.getState().activeDocumentPath
    const activeFile = activeSession
      ? useEditorStore.getState().documentSessions[activeSession]?.filePath
      : current
    if (!activeFile || !hasDirtyDocument(activeFile)) {
      return Promise.resolve(activate())
    }

    const requestVersion = ++_navigationRequestVersion
    return confirmUnsavedDocument(activeFile).then((confirmed) => {
      if (!confirmed || requestVersion !== _navigationRequestVersion) return false
      return activate()
    })
  },

  cycleMru: (direction) => {
    const { currentFile, mru } = get()
    if (!currentFile || mru.length < 2) return
    const currentIndex = mru.findIndex((path) => normalizeDocumentPath(path) === normalizeDocumentPath(currentFile))
    const index = currentIndex < 0 ? 0 : currentIndex
    const nextIndex = (index + direction + mru.length) % mru.length
    const nextPath = mru[nextIndex]
    void get().setCurrentFile(nextPath, true)
  },

  setLoading: (loading) => set({ isLoading: loading }),

  clearWorkspace: () => {
    void (async () => {
      get().cancelWorkspaceScan()
      get().cancelLogIndex()
      const shouldClearRuntimeState = window.confirm(
        '关闭工作区后，是否同时清空已打开文件、编辑器内容和 AI 对话记录？',
      )

      if (!shouldClearRuntimeState) {
        stopWorkspaceWatch()
        set({ workspaceRoot: null, workspaceFiles: [] })
        return
      }

      for (const filePath of listDirtyDocumentPaths()) {
        if (!(await confirmUnsavedDocument(filePath))) return
      }

      stopWorkspaceWatch()
      set({ workspaceRoot: null, workspaceFiles: [] })
      for (const [, unsub] of _streamUnsubs) {
        try {
          unsub()
        } catch {
          // best effort
        }
      }
      _streamUnsubs.clear()
      _loadingPaths.clear()

      void window.electronAPI.agent.cancel()
      const chatStore = useChatStore.getState()
      chatStore.clearMessages()
      chatStore.clearQuotes()
      chatStore.setAgentStatus('idle')
      useSessionContextStore.getState().resetConversationContext()

      set({ files: [], currentFile: null, mru: [], isLoading: false })
      useEditorStore.setState({
        content: '',
        previewContent: null,
        selectedText: null,
        selectedLineRange: null,
        cursorLine: 0,
        cursorColumn: 0,
        isDirty: false,
      })
      useEditorStore.getState().clearLogIndexedView()
      useEditorStore.getState().clearDocuments()
      useEditorStore.getState().bumpEditorHydration()
    })()
  },

  openFolder: async (requestedRoot?: string) => {
    const { setLoading } = get()
    set({ workspaceScanStatus: 'idle', workspaceScanError: null })
    setLoading(true)
    try {
      const res: any = await window.electronAPI.file.openFolder(requestedRoot)
      if (res?.cancelled) return
      if (!res?.success || !res.data) {
        const error = res?.error ?? '打开文件夹失败'
        console.error('openFolder:', error)
        set({ workspaceScanStatus: 'error', workspaceScanError: error })
        return
      }
      const { root: workspaceRoot, files } = res.data as {
        root: string
        files: WorkspaceFileEntry[]
      }
      set({
        workspaceRoot,
        workspaceFiles: files ?? [],
      })
      await beginWorkspaceWatch(workspaceRoot, get)
      await get().startWorkspaceScan(workspaceRoot)
      void window.electronAPI.recent.record(workspaceRoot, 'folder')
      void useSessionContextStore.getState().loadWorkspaceSession(workspaceRoot)
    } catch (e) {
      console.error('openFolder error:', e)
      set({ workspaceScanStatus: 'error', workspaceScanError: e instanceof Error ? e.message : String(e) })
    } finally {
      setLoading(false)
    }
  },

  openWorkspaceFile: async (filePath: string) => {
    const { files, addFile, setCurrentFile } = get()
    if (files.some((f) => normalizeDocumentPath(f.path) === normalizeDocumentPath(filePath))) {
      setCurrentFile(filePath)
      return
    }
    const infoResult: any = await window.electronAPI.file.getInfo(filePath)
    if (infoResult?.success && infoResult.data) {
      const info = infoResult.data
      addFile({
        path: info.path,
        name: info.name,
        size: info.size,
        extension: info.extension,
        lines: info.lines,
        encoding: info.encoding,
        active: false,
      })
    } else {
      const name = filePath.split(/[/\\]/).pop() || filePath
      addFile({
        path: filePath,
        name,
        size: 0,
        extension: '',
        lines: 0,
        encoding: '',
        active: false,
      })
    }
    setCurrentFile(filePath)
  },

  openLinkedMarkdown: async (targetPath: string, replacePath: string) => {
    const infoResult: any = await window.electronAPI.file.getInfo(targetPath)
    if (!infoResult?.success || !infoResult.data) {
      window.alert('找不到链接的 Markdown 文件')
      return
    }

    const info = infoResult.data as {
      path: string
      name: string
      size: number
      extension: string
      lines: number
      encoding: string
    }

    if (hasDirtyDocument(replacePath) && !(await confirmUnsavedDocument(replacePath))) return

    const { files } = get()
    const entry: FileEntry = {
      path: info.path,
      name: info.name,
      size: info.size,
      extension: info.extension,
      lines: info.lines,
      encoding: info.encoding,
      active: false,
    }
    const nextFiles = [
      ...files.filter((f) => {
        const key = normalizeDocumentPath(f.path)
        return key !== normalizeDocumentPath(info.path) && key !== normalizeDocumentPath(replacePath)
      }),
      entry,
    ]

    set({ files: nextFiles })
    const switched = await get().setCurrentFile(info.path)
    if (switched && normalizeDocumentPath(replacePath) !== normalizeDocumentPath(info.path)) {
      useEditorStore.getState().removeDocument(replacePath)
    }
  },

  /* ── IPC-driven actions ── */

  openFileFromLaunch: async (filePath: string) => {
    // 双击文档启动：文件不在当前工作区（或无工作区）时先加载所在目录为工作区，再打开文档
    const { workspaceRoot } = get()
    const normalizedFile = normalizeDocumentPath(filePath)
    const isInside = workspaceRoot
      ? normalizedFile === normalizeDocumentPath(workspaceRoot) ||
        normalizedFile.startsWith(normalizeDocumentPath(workspaceRoot).replace(/\/?$/, '/'))
      : false
    if (!workspaceRoot || !isInside) {
      const normalized = filePath.replace(/[\\/]+$/, '')
      const index = Math.max(normalized.lastIndexOf('/'), normalized.lastIndexOf('\\'))
      const directory = index > 0 ? normalized.slice(0, index) : normalized
      if (directory) await get().openFolder(directory)
    }
    await get().openFile(filePath)
  },

  openFile: async (filePath?: string) => {
    const { setLoading, addFile, setCurrentFile } = get()
    setLoading(true)
    try {
      let resolvedPath: string | null = null

      if (filePath) {
        // Direct path import from drag-and-drop — skip native dialog
        resolvedPath = filePath
      } else {
        // Open native dialog to pick a file
        const result: any = await window.electronAPI.file.open()
        if (!result?.success || !result.data) {
          setLoading(false)
          return
        }
        resolvedPath = result.data
      }

      if (!resolvedPath) {
        setLoading(false)
        return
      }

      // Avoid duplicates
      if (get().files.some((f) => normalizeDocumentPath(f.path) === normalizeDocumentPath(resolvedPath!))) {
        setCurrentFile(resolvedPath) // auto-loads content internally
        setLoading(false)
        return
      }

      // Get file metadata
      const infoResult: any = await window.electronAPI.file.getInfo(resolvedPath)
      if (infoResult?.success && infoResult.data) {
        const info = infoResult.data
        addFile({
          path: info.path,
          name: info.name,
          size: info.size,
          extension: info.extension,
          lines: info.lines,
          encoding: info.encoding,
          active: false,
        })
        void window.electronAPI.recent.record(info.path, 'file')
      } else {
        // fallback: add with minimal info
        const name = resolvedPath.split(/[/\\]/).pop() || resolvedPath
        addFile({
          path: resolvedPath,
          name,
          size: 0,
          extension: '',
          lines: 0,
          encoding: '',
          active: false,
        })
      }

      setCurrentFile(resolvedPath) // auto-triggers loadFileContent
    } catch (err) {
      console.error('openFile error:', err)
    } finally {
      setLoading(false)
    }
  },

  createFile: async () => {
    const { setLoading, openFile } = get()
    setLoading(true)
    try {
      const result: any = await window.electronAPI.file.create()
      if (result?.cancelled) return
      if (!result?.success || !result.data) {
        if (result?.error) console.error('createFile:', result.error)
        return
      }

      const createdPath = result.data as string
      await openFile(createdPath)

      // 若新建文件位于当前工作区内，立即刷新工作区文件树。
      const { workspaceRoot, refreshWorkspaceFiles } = get()
      if (workspaceRoot) {
        const normRoot = workspaceRoot.replace(/\\/g, '/').toLowerCase()
        const normPath = createdPath.replace(/\\/g, '/').toLowerCase()
        if (normPath === normRoot || normPath.startsWith(normRoot + '/')) {
          await refreshWorkspaceFiles()
        }
      }
    } catch (err) {
      console.error('createFile error:', err)
    } finally {
      setLoading(false)
    }
  },

  loadFileContent: async (filePath: string, force = false) => {
    if (!force && useEditorStore.getState().activateDocument(filePath)) return

    get().cancelLogIndex()

    // Keep only the latest stream alive; stale streams waste memory and listeners.
    for (const [path, unsub] of _streamUnsubs) {
      if (path === filePath) continue
      try {
        unsub()
      } catch {
        // best effort
      }
      _streamUnsubs.delete(path)
      _loadingPaths.delete(path)
    }

    // Dedup: skip if this path is already being loaded
    if (_loadingPaths.has(filePath)) return
    _loadingPaths.add(filePath)

    const { setLoading } = get()
    setLoading(true)

    /** 切换文件时立即清空，避免 MDXEditor 仍展示上一个文件；加载完成后写入新内容 */
    useEditorStore.getState().clearLogIndexedView()

    const cleanup = () => {
      const unsub = _streamUnsubs.get(filePath)
      if (unsub) {
        try {
          unsub()
        } catch {
          // best effort
        }
        _streamUnsubs.delete(filePath)
      }
      setLoading(false)
      _loadingPaths.delete(filePath)
    }

    try {
      let fileSize = 0
      let fileLines: number | undefined
      try {
        const infoResult: { success?: boolean; data?: { size?: number; lines?: number } } =
          await window.electronAPI.file.getInfo(filePath)
        fileSize = infoResult?.data?.size ?? 0
        fileLines = infoResult?.data?.lines
      } catch {
        // If getInfo fails, fall through to full read below
      }

      const isLogFile = filePath.toLowerCase().endsWith('.log')

      if (isLogFile && fileSize > EDITOR_LARGE_FILE_BYTES) {
        if (get().currentFile === filePath) {
          useEditorStore.getState().setSampledDocument(filePath, '', 'log')
          useEditorStore.getState().setMode('log')
          useEditorStore.getState().markClean()
          useEditorStore.getState().bumpEditorHydration()
          void get().startLogIndex(filePath)
        }
        cleanup()
        return
      }

      if (fileSize > EDITOR_LARGE_FILE_BYTES) {
        const sample = await readFileLineSample(filePath, EDITOR_SAMPLE_LINES)
        if (get().currentFile === filePath) {
          const banner = formatLargeFileEditorBanner(fileSize, fileLines)
          useEditorStore.getState().setSampledDocument(filePath, banner + sample, inferMode(filePath))
        }
        cleanup()
        return
      }

      // ── Full read path for files ≤2MB ──
      const result = await window.electronAPI.file.readText(filePath)
      if (result?.success && result.data && get().currentFile === filePath) {
        useEditorStore.getState().setDocumentSnapshot(filePath, result.data as TextDocumentSnapshot)
      }
      cleanup()
    } catch (err) {
      console.error('loadFileContent error:', err)
      cleanup()
    }
  },
}))
