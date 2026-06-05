import { create } from 'zustand'
import { useEditorStore, inferMode } from './editorStore'
import { useChatStore } from './chatStore'
import { useSessionContextStore } from './sessionContextStore'
import type { WorkspaceConfigFilePayload, WorkspaceFileEntry } from '../../../shared/types'
import { EDITOR_LARGE_FILE_BYTES, EDITOR_SAMPLE_LINES } from '../../../shared/context-budget'

/** Track in-flight loads to prevent concurrent loadContent calls for the same file. */
const _loadingPaths = new Set<string>()
/** Active renderer-side stream subscriptions keyed by file path. */
const _streamUnsubs = new Map<string, () => void>()

export interface FileEntry {
  path: string
  name: string
  size: number
  extension: string
  lines: number
  encoding: string
  active: boolean
}

function confirmDiscardUnsavedChanges(): boolean {
  if (!useEditorStore.getState().isDirty) return true
  return window.confirm('当前文件有未保存修改，继续操作会丢失这些更改。是否继续？')
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
  isLoading: boolean
  /** 当前打开的工作区根路径（打开文件夹） */
  workspaceRoot: string | null
  /** 工作区内 config/config.json 快照（打开文件夹时由主进程写入/创建） */
  workspaceConfig: WorkspaceConfigFilePayload | null
  /** 每次成功打开文件夹递增，用于触发自动连通性检测 */
  workspaceOpenNonce: number
  /** 工作区内扫描到的文件列表 */
  workspaceFiles: WorkspaceFileEntry[]
  /** 主动刷新工作区文件夹内容 */
  refreshWorkspaceFiles: () => Promise<void>
  addFile: (file: FileEntry) => void
  removeFile: (path: string) => void
  setCurrentFile: (path: string | null) => void
  setLoading: (loading: boolean) => void
  openFile: (filePath?: string) => Promise<void>
  createFile: () => Promise<void>
  openFolder: () => Promise<void>
  clearWorkspace: () => void
  /** 从工作区列表打开文件（必要时加入已打开列表） */
  openWorkspaceFile: (filePath: string) => Promise<void>
  /** 打开 Markdown 链接：关闭来源文件并切换到目标文件 */
  openLinkedMarkdown: (targetPath: string, replacePath: string) => Promise<void>
  loadFileContent: (filePath: string) => Promise<void>
}

export const useFileStore = create<FileState>((set, get) => ({
    refreshWorkspaceFiles: async () => {
      const { workspaceRoot } = get()
      if (!workspaceRoot) return
      try {
        const res: any = await window.electronAPI.file.listWorkspaceFiles(workspaceRoot)
        if (res?.success && Array.isArray(res.data)) {
          set({ workspaceFiles: res.data })
        }
      } catch (e) {
        // ignore
      }
    },
  files: [],
  currentFile: null,
  isLoading: false,
  workspaceRoot: null,
  workspaceConfig: null,
  workspaceOpenNonce: 0,
  workspaceFiles: [],

  addFile: (file) =>
    set((state) => ({
      files: [...state.files.filter((f) => f.path !== file.path), { ...file, active: false }],
    })),

  removeFile: (path) => {
    const state = get()
    if (state.currentFile === path && !confirmDiscardUnsavedChanges()) {
      return
    }
    const newFiles = state.files.filter((f) => f.path !== path)
    const wasCurrent = state.currentFile === path
    const newCurrent = wasCurrent ? (newFiles[0]?.path ?? null) : state.currentFile

    set({
      files: newFiles,
      currentFile: newCurrent,
    })

    // Auto-load the newly selected file
    if (wasCurrent && newCurrent) {
      get().loadFileContent(newCurrent)
    }
  },

  setCurrentFile: (path) => {
    if (!path) {
      if (!confirmDiscardUnsavedChanges()) return
      set({ currentFile: null })
      return
    }

    if (path !== get().currentFile && !confirmDiscardUnsavedChanges()) {
      return
    }

    set((state) => ({
      currentFile: path,
      files: state.files.map((f) => ({ ...f, active: f.path === path })),
    }))

    // Auto-load content when switching files
    get().loadFileContent(path)
  },

  setLoading: (loading) => set({ isLoading: loading }),

  clearWorkspace: () => {
    const shouldClearRuntimeState = window.confirm(
      '关闭工作区后，是否同时清空已打开文件、编辑器内容和 AI 对话记录？',
    )

    set({ workspaceRoot: null, workspaceFiles: [], workspaceConfig: null })

    if (!shouldClearRuntimeState) {
      return
    }

    // Stop all in-flight streams and detach renderer listeners.
    for (const [, unsub] of _streamUnsubs) {
      try {
        unsub()
      } catch {
        // best effort
      }
    }
    _streamUnsubs.clear()
    _loadingPaths.clear()

    // Cancel active AI streaming and clear conversation state.
    void window.electronAPI.agent.cancel()
    const chatStore = useChatStore.getState()
    chatStore.clearMessages()
    chatStore.clearQuotes()
    chatStore.setAgentStatus('idle')
    useSessionContextStore.getState().resetConversationContext()

    // Clear open files and editor content so memory can be reclaimed.
    set({ files: [], currentFile: null, isLoading: false })
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
    useEditorStore.getState().bumpEditorHydration()
  },

  openFolder: async () => {
    const { setLoading } = get()
    setLoading(true)
    try {
      const res: any = await window.electronAPI.file.openFolder()
      if (res?.cancelled) return
      if (!res?.success || !res.data) {
        if (res?.error) console.error('openFolder:', res.error)
        return
      }
      const { root, files, workspaceConfig } = res.data as {
        root: string
        files: WorkspaceFileEntry[]
        workspaceConfig?: WorkspaceConfigFilePayload
      }
      set((state) => ({
        workspaceRoot: root,
        workspaceFiles: files ?? [],
        workspaceConfig: workspaceConfig ?? null,
        workspaceOpenNonce: state.workspaceOpenNonce + 1,
      }))
      void useSessionContextStore.getState().loadWorkspaceSession(root)
    } catch (e) {
      console.error('openFolder error:', e)
    } finally {
      setLoading(false)
    }
  },

  openWorkspaceFile: async (filePath: string) => {
    const { files, addFile, setCurrentFile } = get()
    if (files.some((f) => f.path === filePath)) {
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
    if (!confirmDiscardUnsavedChanges()) return

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

    const { files } = get()
    const withoutSource = files.filter((f) => f.path !== replacePath)
    const entry: FileEntry = {
      path: info.path,
      name: info.name,
      size: info.size,
      extension: info.extension,
      lines: info.lines,
      encoding: info.encoding,
      active: true,
    }
    const nextFiles = [
      ...withoutSource.filter((f) => f.path !== info.path),
      { ...entry, active: true },
    ].map((f) => ({ ...f, active: f.path === info.path }))

    set({
      files: nextFiles,
      currentFile: info.path,
    })
    await get().loadFileContent(info.path)
  },

  /* ── IPC-driven actions ── */

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
      if (get().files.some((f) => f.path === resolvedPath)) {
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

  loadFileContent: async (filePath: string) => {
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
    useEditorStore.setState({ content: '', isDirty: false })
    useEditorStore.getState().bumpEditorHydration()

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
          useEditorStore.getState().setLogIndexedView(filePath, fileLines ?? 0)
          useEditorStore.getState().setMode('log')
          useEditorStore.getState().markClean()
          useEditorStore.getState().bumpEditorHydration()
          void window.electronAPI.log.getIndex(filePath).then((res) => {
            const payload = res as { success?: boolean; data?: { totalLines?: number } }
            if (
              payload?.success &&
              payload.data?.totalLines != null &&
              get().currentFile === filePath
            ) {
              useEditorStore.getState().setLogIndexedView(filePath, payload.data.totalLines)
            }
          })
        }
        cleanup()
        return
      }

      if (fileSize > EDITOR_LARGE_FILE_BYTES) {
        const sample = await readFileLineSample(filePath, EDITOR_SAMPLE_LINES)
        if (get().currentFile === filePath) {
          const banner = formatLargeFileEditorBanner(fileSize, fileLines)
          useEditorStore.getState().setContent(banner + sample)
          useEditorStore.getState().setMode(inferMode(filePath))
          useEditorStore.getState().markClean()
          useEditorStore.getState().bumpEditorHydration()
        }
        cleanup()
        return
      }

      // ── Full read path for files ≤2MB ──
      const result: { success?: boolean; data?: { content?: string } } =
        await window.electronAPI.file.read(filePath)
      if (result?.success && result.data && get().currentFile === filePath) {
        useEditorStore.getState().setContent(result.data.content)
        useEditorStore.getState().setMode(inferMode(filePath))
        useEditorStore.getState().markClean()
        useEditorStore.getState().bumpEditorHydration()
      }
      cleanup()
    } catch (err) {
      console.error('loadFileContent error:', err)
      cleanup()
    }
  },
}))
