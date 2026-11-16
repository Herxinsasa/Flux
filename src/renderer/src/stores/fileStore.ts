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
import { confirmUnsavedDocument, listDirtyDocumentPaths, prepareUnsavedDocument } from '../utils/unsavedChangesGuard'
import { captureEditableFocus } from '../utils/editorFocus'
import { reportWorkspaceChanged } from '../utils/workspaceSync'
import { beginDocumentOperation } from '../utils/documentOperations'

/** Track in-flight loads to prevent concurrent loadContent calls for the same file. */
const _loadingPaths = new Set<string>()
const _documentCredentials = new Map<string, import('../../../shared/types').DocumentCredential>()
/** Active renderer-side stream subscriptions keyed by file path. */
const _streamUnsubs = new Map<string, () => void>()
let _workspaceScanUnsub: (() => void) | null = null
let _workspaceWatchUnsub: (() => void) | null = null
let _workspaceWatchId: string | null = null
let _workspaceRefreshTimer: number | null = null
let _workspaceScanRequestVersion = 0
let _logIndexUnsub: (() => void) | null = null
let _logIndexRequestVersion = 0
let _navigationRequestVersion = 0
let _navigationPromptPending = false
const _navigationPromptWaiters = new Set<() => void>()
let _navigationPrompt: NavigationPromptEntry | null = null
let _openFileSequence = 0
let _openFileRequestVersion = 0
const _openFileInFlightByPath = new Map<string, number>()
const _openFileSettledByPath = new Map<string, Promise<void>>()
let _workspaceSelectionVersion = 0
const _externalReloadChecks = new Set<string>()
const MAX_INACTIVE_DOCUMENT_CACHE = 8
const MAX_INACTIVE_DOCUMENT_CACHE_BYTES = 64 * 1024 * 1024

function estimateDocumentSessionBytes(draft: string, snapshotContent?: string): number {
  const draftBytes = draft.length * 2
  const snapshotBytes = snapshotContent && snapshotContent !== draft ? snapshotContent.length * 2 : 0
  return draftBytes + snapshotBytes
}

function pruneInactiveDocumentCache(activeFilePath: string): void {
  const activeKey = normalizeDocumentPath(activeFilePath)
  const editor = useEditorStore.getState()
  const candidates = Object.entries(editor.documentSessions)
    .filter(([key, session]) => (
      key !== activeKey
      && !session.dirty
      && (session.snapshot !== null || session.draft.length > 0)
    ))
    .map(([key, session]) => ({
      key,
      filePath: session.filePath,
      lastActivatedAt: session.lastActivatedAt,
      bytes: estimateDocumentSessionBytes(session.draft, session.snapshot?.content),
    }))
    .sort((a, b) => a.lastActivatedAt - b.lastActivatedAt)

  let cachedBytes = candidates.reduce((total, session) => total + session.bytes, 0)
  let cachedCount = candidates.length
  for (const session of candidates) {
    if (cachedCount <= MAX_INACTIVE_DOCUMENT_CACHE && cachedBytes <= MAX_INACTIVE_DOCUMENT_CACHE_BYTES) break
    useEditorStore.getState().removeDocument(session.filePath)
    cachedCount--
    cachedBytes -= session.bytes
  }
}

function discardPendingDocumentLoad(filePath: string): void {
  const key = normalizeDocumentPath(filePath)
  const session = useEditorStore.getState().documentSessions[key]
  if (!session || session.dirty || session.snapshot !== null || session.draft.length > 0) return
  useEditorStore.getState().removeDocument(filePath)
}

interface NavigationPreparation {
  proceed: boolean
  finalize: () => Promise<void>
}

interface NavigationPromptEntry {
  key: string
  promise: Promise<NavigationPreparation>
}

function setNavigationPromptPending(pending: boolean): void {
  _navigationPromptPending = pending
  if (pending) return
  for (const resolve of _navigationPromptWaiters) resolve()
  _navigationPromptWaiters.clear()
}

function waitForNavigationPromptToSettle(): Promise<void> {
  if (!_navigationPromptPending) return Promise.resolve()
  return new Promise((resolve) => _navigationPromptWaiters.add(resolve))
}

/** 并发导航共用同源文档的一次未保存确认，避免重复弹窗与并发取消。 */
async function prepareNavigationSource(filePath: string): Promise<NavigationPreparation> {
  const key = normalizeDocumentPath(filePath)
  while (true) {
    if (_navigationPrompt) {
      if (_navigationPrompt.key === key) return _navigationPrompt.promise
      await _navigationPrompt.promise.catch(() => undefined)
      continue
    }
    if (_navigationPromptPending) {
      await waitForNavigationPromptToSettle()
      continue
    }
    break
  }
  const entry: NavigationPromptEntry = {
    key,
    promise: prepareUnsavedDocument(filePath).finally(() => {
      if (_navigationPrompt === entry) _navigationPrompt = null
      setNavigationPromptPending(false)
    }),
  }
  _navigationPrompt = entry
  setNavigationPromptPending(true)
  return entry.promise
}

/** 等待同路径的完整打开落定；若本请求已被更新请求取代则提前返回。 */
async function waitForDuplicateOpenToSettle(pathKey: string, requestVersion: number): Promise<void> {
  while (true) {
    if (requestVersion !== _openFileRequestVersion) return
    const pending = _openFileSettledByPath.get(pathKey)
    if (pending) {
      await pending.catch(() => undefined)
      continue
    }
    if (_navigationPromptPending) {
      await waitForNavigationPromptToSettle()
      continue
    }
    return
  }
}

function stopLogIndex(status: 'idle' | 'cancelled'): void {
  _logIndexRequestVersion++
  const taskId = useFileStore.getState().logIndexTaskId
  if (taskId) void window.electronAPI.log.cancelIndex(taskId)
  _logIndexUnsub?.()
  _logIndexUnsub = null
  useFileStore.setState({
    logIndexTaskId: null,
    logIndexStatus: taskId ? status : 'idle',
    logIndexError: null,
  })
}

/** 文档切换时丢弃旧索引；复位为 idle，避免新文件展示“日志索引已取消”。 */
function resetLogIndexForDocumentSwitch(): void {
  const state = useFileStore.getState()
  if (
    state.logIndexTaskId === null &&
    _logIndexUnsub === null &&
    state.logIndexStatus === 'idle' &&
    useEditorStore.getState().logIndexedPath === null
  ) {
    return
  }
  stopLogIndex('idle')
  useEditorStore.getState().clearLogIndexedView()
}

async function promptExternalFileReload(filePath: string): Promise<void> {
  const key = normalizeDocumentPath(filePath)
  if (_externalReloadChecks.has(key)) return
  const session = useEditorStore.getState().documentSessions[key]
  if (!session?.snapshot || session.sampled) return

  _externalReloadChecks.add(key)
  try {
    const response = await window.electronAPI.file.readText(filePath)
    if (!response.success || !response.data) return
    const latest = useEditorStore.getState().documentSessions[key]
    if (!latest?.snapshot || latest.snapshot.version.contentHash === response.data.version.contentHash) return
    const message = latest.dirty
      ? '文件已在外部修改。重新加载将放弃 Flux 中未保存的更改，是否继续？'
      : '文件已在外部修改，是否重新加载？'
    const restoreEditorFocus = captureEditableFocus()
    if (window.confirm(message)) useEditorStore.getState().setDocumentSnapshot(filePath, response.data)
    restoreEditorFocus()
  } catch (error) {
    console.warn('External file reload check failed:', error)
  } finally {
    _externalReloadChecks.delete(key)
  }
}

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
    const currentFile = get().currentFile
    if (currentFile && (event.changedPaths ?? []).some((filePath) => normalizeDocumentPath(filePath) === normalizeDocumentPath(currentFile))) {
      void promptExternalFileReload(currentFile)
    }
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
  setCurrentFile: (path: string | null, preserveMru?: boolean, skipConfirmation?: boolean) => Promise<boolean>
  cycleMru: (direction: 1 | -1) => void
  setLoading: (loading: boolean) => void
  openFile: (filePath?: string, credential?: import('../../../shared/types').DocumentCredential) => Promise<void>
  /** 双击文档启动：保留现有工作区，将文档作为普通或外部工作集文件打开 */
  openFileFromLaunch: (filePath: string) => Promise<void>
  createFile: () => Promise<void>
  openFolder: (root?: string, initialize?: boolean) => Promise<void>
  clearWorkspace: () => void
  /** 从工作区列表打开文件（必要时加入已打开列表） */
  openWorkspaceFile: (filePath: string) => Promise<void>
  /** 打开 Markdown 链接：关闭来源文件并切换到目标文件 */
  openLinkedMarkdown: (targetPath: string, replacePath: string) => Promise<void>
  loadFileContent: (filePath: string, force?: boolean) => Promise<boolean>
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
    const requestVersion = ++_workspaceScanRequestVersion
    let scannedFiles: WorkspaceFileEntry[] = []
    const queued: WorkspaceScanEvent[] = []
    const applyEvent = (event: WorkspaceScanEvent) => {
      if (event.taskId !== taskId || get().workspaceRoot !== root || requestVersion !== _workspaceScanRequestVersion) return
      if (event.status === 'batch' && event.entries) {
        scannedFiles = mergeWorkspaceEntries(scannedFiles, event.entries)
        return
      }
      if (event.status === 'complete') {
        set((state) => ({
          workspaceFiles: scannedFiles,
          workspaceScanTaskId: null,
          workspaceScanVersion: state.workspaceScanVersion + 1,
          workspaceScanStatus: 'complete',
          workspaceScanError: null,
        }))
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
    set({
      workspaceScanTaskId: null,
      workspaceScanStatus: 'scanning',
      workspaceScanError: null,
    })
    const response = await window.electronAPI.file.scanWorkspace(root)
    if (!response.success || !response.data || get().workspaceRoot !== root || requestVersion !== _workspaceScanRequestVersion) {
      if (response.data) void window.electronAPI.file.cancelWorkspaceScan(response.data.taskId)
      if (_workspaceScanUnsub === unsubscribe) {
        _workspaceScanUnsub = null
        unsubscribe()
      }
      if (get().workspaceRoot === root && requestVersion === _workspaceScanRequestVersion) {
        set({ workspaceScanStatus: 'error', workspaceScanError: response.error ?? 'Workspace scan failed' })
      }
      return
    }
    taskId = response.data.taskId
    set({ workspaceScanTaskId: taskId })
    queued.forEach(applyEvent)
  },
  cancelWorkspaceScan: () => {
    _workspaceScanRequestVersion++
    const taskId = get().workspaceScanTaskId
    if (taskId) void window.electronAPI.file.cancelWorkspaceScan(taskId)
    _workspaceScanUnsub?.()
    _workspaceScanUnsub = null
    set({ workspaceScanTaskId: null, workspaceScanStatus: taskId ? 'cancelled' : 'idle' })
  },
  startLogIndex: async (filePath) => {
    if (!get().currentFile || normalizeDocumentPath(get().currentFile!) !== normalizeDocumentPath(filePath)) return
    get().cancelLogIndex()
    _logIndexUnsub?.()

    let taskId: string | null = null
    const requestVersion = ++_logIndexRequestVersion
    const queued: LogIndexTaskEvent[] = []
    const applyEvent = (event: LogIndexTaskEvent) => {
      if (event.taskId !== taskId) return
      if (get().currentFile !== filePath || requestVersion !== _logIndexRequestVersion) {
        if (_logIndexUnsub === unsubscribe) _logIndexUnsub = null
        unsubscribe()
        return
      }
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
      if (requestVersion === _logIndexRequestVersion) {
        if (get().currentFile === filePath) {
          set({ logIndexStatus: 'error', logIndexError: response.error ?? 'Log indexing failed' })
        } else {
          set({ logIndexTaskId: null, logIndexStatus: 'idle', logIndexError: null })
        }
      }
      return
    }
    taskId = response.data.taskId
    set({ logIndexTaskId: taskId })
    queued.forEach(applyEvent)
  },
  cancelLogIndex: () => stopLogIndex('cancelled'),
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

      if (wasCurrent) resetLogIndexForDocumentSwitch()
      set({ files: newFiles, currentFile: newCurrent, mru: newMru })
      useEditorStore.getState().removeDocument(path)
      const credential = _documentCredentials.get(key)
      if (credential) {
        _documentCredentials.delete(key)
        void window.electronAPI.document.release(credential)
      }
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

  setCurrentFile: async (path, preserveMru = false, skipConfirmation = false) => {
    if (_navigationPromptPending && !skipConfirmation) return false
    const current = get().currentFile
    if (path && current && normalizeDocumentPath(path) === normalizeDocumentPath(current)) {
      if (!useEditorStore.getState().activateDocument(path)) {
        useEditorStore.getState().beginDocumentLoad(path)
        return get().loadFileContent(path, true)
      }
      return true
    }

    const activate = async (): Promise<boolean> => {
      resetLogIndexForDocumentSwitch()
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
        return get().loadFileContent(path, true)
      }
      return true
    }

    const activeSession = useEditorStore.getState().activeDocumentPath
    const activeFile = activeSession
      ? useEditorStore.getState().documentSessions[activeSession]?.filePath
      : current
    if (skipConfirmation || !activeFile || !hasDirtyDocument(activeFile)) {
      return activate()
    }

    if (_navigationPromptPending) return false
    setNavigationPromptPending(true)
    const requestVersion = ++_navigationRequestVersion
    try {
      const confirmed = await confirmUnsavedDocument(activeFile)
      if (!confirmed || requestVersion !== _navigationRequestVersion) return false
      return activate()
    } finally {
      setNavigationPromptPending(false)
    }
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
    _workspaceSelectionVersion++
    void (async () => {
      get().cancelWorkspaceScan()
      get().cancelLogIndex()
      const shouldClearRuntimeState = window.confirm(
        '关闭工作区后，是否同时清空已打开文件、编辑器内容和 AI 对话记录？',
      )

      if (!shouldClearRuntimeState) {
        stopWorkspaceWatch()
        set({ workspaceRoot: null, workspaceFiles: [] })
        reportWorkspaceChanged(null)
        return
      }

      for (const filePath of listDirtyDocumentPaths()) {
        if (!(await confirmUnsavedDocument(filePath))) return
      }

      stopWorkspaceWatch()
      set({ workspaceRoot: null, workspaceFiles: [] })
      reportWorkspaceChanged(null)
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
      for (const credential of _documentCredentials.values()) void window.electronAPI.document.release(credential)
      _documentCredentials.clear()
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

  openFolder: async (requestedRoot?: string, initialize = false) => {
    if (initialize && _workspaceSelectionVersion > 0) return
    const selectionVersion = initialize ? _workspaceSelectionVersion : ++_workspaceSelectionVersion
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
      if (selectionVersion !== _workspaceSelectionVersion) return
      set({
        workspaceRoot,
        workspaceFiles: files ?? [],
      })
      reportWorkspaceChanged(workspaceRoot)
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
    await get().openFile(filePath)
  },

  openLinkedMarkdown: async (targetPath: string, replacePath: string) => {
    await get().openFile(targetPath)
    if (get().currentFile && normalizeDocumentPath(get().currentFile!) === normalizeDocumentPath(targetPath) && normalizeDocumentPath(replacePath) !== normalizeDocumentPath(targetPath)) {
      get().removeFile(replacePath)
    }
    return
  },

  /* ── IPC-driven actions ── */

  openFileFromLaunch: async (filePath: string) => {
    // 工作区只由“打开文件夹”显式切换；系统关联或第二次启动传入的文件进入当前工作集。
    await get().openFile(filePath)
  },

  openFile: async (filePath?: string, suppliedCredential?: import('../../../shared/types').DocumentCredential) => {
    const endOperation = beginDocumentOperation()
    if (!endOperation) {
      if (suppliedCredential) await window.electronAPI.document.release(suppliedCredential)
      return
    }
    const requestVersion = ++_openFileSequence
    const { setLoading, addFile, setCurrentFile } = get()
    let pathKey: string | null = null
    let credential: import('../../../shared/types').DocumentCredential | null = suppliedCredential ?? null
    let reservedPath = credential?.filePath ?? ''
    let ownsPathInFlight = false
    let settlePromise: Promise<void> | null = null
    let settlePath: () => void = () => undefined
    let stagedSession = false
    let stagedFile = false
    let committed = false
    let accepted = false
    let previousFile = get().currentFile
    let previousMru = get().mru
    const isLatestPublished = () => requestVersion === _openFileRequestVersion
    const isLatestRequest = () =>
      isLatestPublished()
      && (!ownsPathInFlight || (pathKey !== null && _openFileInFlightByPath.get(pathKey) === requestVersion))
    const releaseCredential = async (): Promise<void> => {
      if (!credential) return
      const current = credential
      credential = null
      await window.electronAPI.document.release(current)
    }
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

      pathKey = normalizeDocumentPath(resolvedPath)
      _openFileRequestVersion = Math.max(_openFileRequestVersion, requestVersion)
      if (!isLatestPublished()) {
        await releaseCredential()
        return
      }

      // Avoid duplicates: wait for an in-flight open of the same path to settle, then re-check.
      if (get().files.some((f) => normalizeDocumentPath(f.path) === pathKey)) {
        let reopening = false
        try {
          while (true) {
            await waitForDuplicateOpenToSettle(pathKey, requestVersion)
            if (!isLatestPublished()) return
            if (!get().files.some((f) => normalizeDocumentPath(f.path) === pathKey)) {
              reopening = true
              break
            }
            const switched = await setCurrentFile(resolvedPath) // auto-loads content internally
            if (switched) return
            if (!isLatestPublished()) return
            // Another unsaved confirmation started meanwhile; wait for it and re-evaluate.
            if (!_navigationPromptPending) return
          }
        } finally {
          if (!reopening) await releaseCredential()
        }
        // The previous open was cleaned up; continue with a fresh full open below.
      }

      ownsPathInFlight = true
      _openFileInFlightByPath.set(pathKey, requestVersion)
      settlePromise = new Promise<void>((resolve) => {
        settlePath = resolve
      })
      _openFileSettledByPath.set(pathKey, settlePromise)
      if (!isLatestRequest()) return

      if (!credential) {
        const reservation = await window.electronAPI.document.reserve({ filePath: resolvedPath, purpose: 'open' })
        if (!reservation.success || !reservation.data) {
          if (isLatestRequest()) window.alert(reservation.error ?? '无法打开文件')
          return
        }
        if (reservation.data.status === 'focused') return
        credential = { filePath: reservation.data.filePath, reservationId: reservation.data.reservationId }
      }
      reservedPath = credential.filePath

      try {
        if (!isLatestRequest()) return
        // Get file metadata
        const infoResult: any = await window.electronAPI.file.getInfo(reservedPath)
        if (!infoResult?.success || !infoResult.data) throw new Error(infoResult?.error ?? '无法读取文件信息')
        if (!isLatestRequest()) return
        const info = infoResult.data
        const mode = inferMode(reservedPath)
        if (info.size > EDITOR_LARGE_FILE_BYTES) {
          const sample = mode === 'log' ? '' : await readFileLineSample(reservedPath, EDITOR_SAMPLE_LINES)
          if (!isLatestRequest()) return
          const content = mode === 'log' ? '' : formatLargeFileEditorBanner(info.size, info.lines) + sample
          useEditorStore.getState().setSampledDocument(reservedPath, content, mode, false)
          stagedSession = true
        } else {
          const read = await window.electronAPI.file.readText(reservedPath)
          if (!read.success || !read.data) throw new Error(read.error ?? '无法读取文件')
          if (!isLatestRequest()) return
          useEditorStore.getState().setDocumentSnapshot(reservedPath, read.data, false)
          stagedSession = true
        }
        if (!isLatestRequest()) return
        addFile({
          path: info.path,
          name: info.name,
          size: info.size,
          extension: info.extension,
          lines: info.lines,
          encoding: info.encoding,
          active: false,
        })
        stagedFile = true
        void window.electronAPI.recent.record(info.path, 'file')

        if (!isLatestRequest()) return
        previousFile = get().currentFile
        previousMru = get().mru
        const activeSession = useEditorStore.getState().activeDocumentPath
        const activeFile = activeSession ? useEditorStore.getState().documentSessions[activeSession]?.filePath : previousFile
        const prepared = activeFile
          ? await prepareNavigationSource(activeFile)
          : { proceed: true, finalize: async () => undefined }
        if (!isLatestRequest() || !prepared.proceed) return
        if (get().currentFile !== previousFile) return
        const commitResult = await window.electronAPI.document.commit(credential)
        if (!isLatestRequest()) return
        if (!commitResult.success) throw new Error(commitResult.error ?? '无法确认文件归属')
        committed = true
        if (!isLatestRequest()) return
        if (!(await setCurrentFile(reservedPath, false, true))) throw new Error('文件加载已取消或失败')
        accepted = true
        _documentCredentials.set(normalizeDocumentPath(reservedPath), credential)
        await prepared.finalize()
        pruneInactiveDocumentCache(reservedPath)
        if (
          isLatestRequest()
          && get().currentFile != null
          && normalizeDocumentPath(get().currentFile!) === normalizeDocumentPath(reservedPath)
          && info.size > EDITOR_LARGE_FILE_BYTES
          && mode === 'log'
        ) void get().startLogIndex(reservedPath)
      } finally {
        if (!accepted) {
          const failedPath = reservedPath
          const failedKey = normalizeDocumentPath(failedPath)
          if (isLatestRequest()) {
            set((state) => {
              const restoring = state.currentFile != null && normalizeDocumentPath(state.currentFile) === failedKey
              const currentFile = restoring ? previousFile : state.currentFile
              return { files: state.files.filter((item) => normalizeDocumentPath(item.path) !== failedKey).map((item) => ({ ...item, active: currentFile != null && normalizeDocumentPath(item.path) === normalizeDocumentPath(currentFile) })), currentFile, mru: restoring ? previousMru : state.mru.filter((item) => normalizeDocumentPath(item) !== failedKey) }
            })
            useEditorStore.getState().removeDocument(failedPath)
            if (previousFile && get().currentFile === previousFile) useEditorStore.getState().activateDocument(previousFile)
          } else if (_openFileInFlightByPath.get(failedKey) === requestVersion) {
            if (stagedFile) {
              set((state) => ({
                files: state.files.filter((item) => normalizeDocumentPath(item.path) !== failedKey),
                mru: state.mru.filter((item) => normalizeDocumentPath(item) !== failedKey),
              }))
            }
            if (stagedSession) useEditorStore.getState().removeDocument(failedPath)
          }
          if (credential) {
            const credentialKey = normalizeDocumentPath(credential.filePath)
            const newerSamePath = _openFileInFlightByPath.get(credentialKey) !== undefined
              && _openFileInFlightByPath.get(credentialKey) !== requestVersion
            if (!(committed && newerSamePath)) await window.electronAPI.document.release(credential)
          }
        }
      }
    } catch (err) {
      console.error('openFile error:', err)
      if (isLatestRequest()) window.alert(err instanceof Error ? err.message : '打开文件失败')
    } finally {
      if (pathKey && ownsPathInFlight && _openFileInFlightByPath.get(pathKey) === requestVersion) {
        _openFileInFlightByPath.delete(pathKey)
      }
      if (pathKey && settlePromise && _openFileSettledByPath.get(pathKey) === settlePromise) {
        _openFileSettledByPath.delete(pathKey)
      }
      settlePath()
      setLoading(false)
      endOperation()
    }
  },

  createFile: async () => {
    const endOperation = beginDocumentOperation()
    if (!endOperation) return
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
      const reservation = await window.electronAPI.document.reserve({ filePath: createdPath, purpose: 'create' })
      if (!reservation.success || !reservation.data) {
        window.alert(reservation.error ?? '无法新建文件')
        return
      }
      if (reservation.data.status === 'focused') return
      if (reservation.data.status === 'owned') {
        await get().setCurrentFile(reservation.data.filePath)
        return
      }
      const credential = { filePath: reservation.data.filePath, reservationId: reservation.data.reservationId }
      let transferred = false
      try {
        const existing = await window.electronAPI.file.readText(credential.filePath)
        if (existing.success && existing.data) {
          if (!window.confirm('文件已存在，是否替换？')) return
          const saved = await window.electronAPI.file.saveText({
            filePath: credential.filePath,
            content: '',
            encoding: existing.data.encoding,
            lineEnding: existing.data.lineEnding,
            expectedVersion: existing.data.version,
          })
          if (!saved.success) throw new Error(saved.error ?? '无法替换文件')
        } else if (existing.code === 'NOT_FOUND') {
          const created: any = await window.electronAPI.file.create(credential)
          if (!created?.success) throw new Error(created?.error ?? '无法创建文件')
        } else {
          throw new Error(existing.error ?? '无法读取目标文件')
        }
        transferred = true
        await openFile(credential.filePath, credential)
      } finally {
        if (!transferred) await window.electronAPI.document.release(credential)
      }

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
      window.alert(err instanceof Error ? err.message : '新建文件失败')
    } finally {
      setLoading(false)
      endOperation()
    }
  },

  loadFileContent: async (filePath: string, force = false) => {
    if (!force && useEditorStore.getState().activateDocument(filePath)) return true

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
    if (_loadingPaths.has(filePath)) return false
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
        if (get().currentFile && normalizeDocumentPath(get().currentFile!) === normalizeDocumentPath(filePath)) {
          useEditorStore.getState().setSampledDocument(filePath, '', 'log')
          useEditorStore.getState().setMode('log')
          useEditorStore.getState().markClean()
          useEditorStore.getState().bumpEditorHydration()
          void get().startLogIndex(filePath)
          pruneInactiveDocumentCache(filePath)
        } else {
          discardPendingDocumentLoad(filePath)
        }
        cleanup()
        return Boolean(get().currentFile && normalizeDocumentPath(get().currentFile!) === normalizeDocumentPath(filePath))
      }

      if (fileSize > EDITOR_LARGE_FILE_BYTES) {
        const sample = await readFileLineSample(filePath, EDITOR_SAMPLE_LINES)
        if (get().currentFile && normalizeDocumentPath(get().currentFile!) === normalizeDocumentPath(filePath)) {
          const banner = formatLargeFileEditorBanner(fileSize, fileLines)
          useEditorStore.getState().setSampledDocument(filePath, banner + sample, inferMode(filePath))
          pruneInactiveDocumentCache(filePath)
        } else {
          discardPendingDocumentLoad(filePath)
        }
        cleanup()
        return Boolean(get().currentFile && normalizeDocumentPath(get().currentFile!) === normalizeDocumentPath(filePath))
      }

      // ── Full read path for files ≤2MB ──
      const result = await window.electronAPI.file.readText(filePath)
      if (
        result?.success
        && result.data
        && get().currentFile
        && normalizeDocumentPath(get().currentFile!) === normalizeDocumentPath(filePath)
      ) {
        useEditorStore.getState().setDocumentSnapshot(filePath, result.data as TextDocumentSnapshot)
        pruneInactiveDocumentCache(filePath)
      } else {
        discardPendingDocumentLoad(filePath)
      }
      cleanup()
      return Boolean(result?.success && result.data && get().currentFile && normalizeDocumentPath(get().currentFile!) === normalizeDocumentPath(filePath))
    } catch (err) {
      console.error('loadFileContent error:', err)
      discardPendingDocumentLoad(filePath)
      cleanup()
      return false
    }
  },
}))
