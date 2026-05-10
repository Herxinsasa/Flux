import { create } from 'zustand'
import { useEditorStore, inferMode } from './editorStore'
import type { WorkspaceConfigFilePayload, WorkspaceFileEntry } from '../../../shared/types'

/** Track in-flight loads to prevent concurrent loadContent calls for the same file. */
const _loadingPaths = new Set<string>()

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
  loadFileContent: (filePath: string) => Promise<void>
}

export const useFileStore = create<FileState>((set, get) => ({
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

  clearWorkspace: () =>
    set({ workspaceRoot: null, workspaceFiles: [], workspaceConfig: null }),

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

      await openFile(result.data as string)
    } catch (err) {
      console.error('createFile error:', err)
    } finally {
      setLoading(false)
    }
  },

  loadFileContent: async (filePath: string) => {
    // Dedup: skip if this path is already being loaded
    if (_loadingPaths.has(filePath)) return
    _loadingPaths.add(filePath)

    const { setLoading } = get()
    setLoading(true)

    /** 切换文件时立即清空，避免 MDXEditor 仍展示上一个文件；加载完成后写入新内容 */
    useEditorStore.setState({ content: '', isDirty: false })
    useEditorStore.getState().bumpEditorHydration()

    const cleanup = () => {
      setLoading(false)
      _loadingPaths.delete(filePath)
    }

    try {
      // Check file size to decide full read vs streaming
      let fileSize = 0
      try {
        const infoResult: any = await window.electronAPI.file.getInfo(filePath)
        fileSize = infoResult?.data?.size ?? 0
      } catch {
        // If getInfo fails, fall through to full read below
      }

      const LARGE_FILE = 10 * 1024 * 1024 // 10MB threshold

      if (fileSize > LARGE_FILE) {
        // ── Streaming path for large files (>10MB) ──
        const editorStore = useEditorStore.getState()
        let accumulated = ''

        window.electronAPI.file.readStream(filePath, (chunk: string | null) => {
          if (chunk === null) {
            // End of stream — 若期间已切换到其它文件则丢弃
            if (get().currentFile === filePath) {
              editorStore.setMode(inferMode(filePath))
              editorStore.markClean()
            }
            cleanup()
            return
          }
          accumulated += chunk
          if (get().currentFile === filePath) {
            editorStore.setContent(accumulated)
            useEditorStore.getState().bumpEditorHydration()
          }
        })
        // Note: cleanup() is called in the end-of-stream callback above,
        // not here, because streaming is asynchronous.
      } else {
        // ── Full read path for small files ──
        const result: any = await window.electronAPI.file.read(filePath)
        if (result?.success && result.data && get().currentFile === filePath) {
          useEditorStore.getState().setContent(result.data.content)
          useEditorStore.getState().setMode(inferMode(filePath))
          useEditorStore.getState().markClean()
          useEditorStore.getState().bumpEditorHydration()
        }
        cleanup()
      }
    } catch (err) {
      console.error('loadFileContent error:', err)
      cleanup()
    }
  },
}))
