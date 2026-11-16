import { afterEach, describe, expect, it, vi } from 'vitest'
import '../../src/renderer/src/registry/builtinModes'
import type { LogIndexPayload, LogIndexTaskEvent } from '../../src/shared/types'
import { useEditorStore } from '../../src/renderer/src/stores/editorStore'
import { useFileStore } from '../../src/renderer/src/stores/fileStore'

const LARGE_BYTES = 16 * 1024 * 1024 + 2

afterEach(() => vi.unstubAllGlobals())

function makeSnapshot(filePath: string, content: string) {
  return {
    success: true,
    data: {
      filePath,
      content,
      encoding: 'utf8',
      lineEnding: 'lf',
      version: { mtimeMs: 1, size: content.length, contentHash: content },
      sampled: false,
    },
  }
}

function makeInfo(filePath: string, size: number) {
  return {
    path: filePath,
    name: filePath.split('/').pop() ?? filePath,
    size,
    extension: filePath.slice(filePath.lastIndexOf('.')),
    lines: 10,
    encoding: 'utf8',
  }
}

function makePayload(filePath: string, totalLines: number): LogIndexPayload {
  return {
    path: filePath,
    sizeBytes: LARGE_BYTES,
    totalLines,
    encoding: 'utf8',
    levelCounts: { fatal: 0, error: 0, warn: 0, info: 0, debug: 0 },
    errorSampleLines: [],
    warnSampleLines: [],
    summaryText: '',
  }
}

function installApi(
  sizes: Record<string, number>,
  options: { index?: (filePath: string) => Promise<unknown> } = {},
) {
  const listeners = new Set<(event: LogIndexTaskEvent) => void>()
  const unsubscribes: ReturnType<typeof vi.fn>[] = []
  const getInfo = vi.fn(async (filePath: string) => ({
    success: true,
    data: makeInfo(filePath, sizes[filePath] ?? 100),
  }))
  const readText = vi.fn(async (filePath: string) => makeSnapshot(filePath, `# ${filePath}`))
  const reserve = vi.fn(async ({ filePath }: { filePath: string }) => ({
    success: true,
    data: { status: 'reserved', filePath, reservationId: `reservation:${filePath}` },
  }))
  const commit = vi.fn(async () => ({ success: true, data: { accepted: true } }))
  const release = vi.fn(async () => ({ success: true, data: { accepted: true } }))
  const index = vi.fn(
    options.index ??
      (async (filePath: string) => ({ success: true, data: { taskId: `task:${filePath}` } })),
  )
  const cancelIndex = vi.fn(async () => ({ success: true, data: { cancelled: true } }))
  const onIndex = vi.fn((listener: (event: LogIndexTaskEvent) => void) => {
    listeners.add(listener)
    const unsubscribe = vi.fn(() => listeners.delete(listener))
    unsubscribes.push(unsubscribe)
    return unsubscribe
  })
  const alert = vi.fn()
  vi.stubGlobal('window', {
    electronAPI: {
      file: { getInfo, readText, open: vi.fn(), create: vi.fn() },
      document: { reserve, commit, release },
      recent: { record: vi.fn(async () => ({ success: true })) },
      log: { index, cancelIndex, onIndex },
    },
    confirm: vi.fn(() => true),
    alert,
  })
  const emit = (event: LogIndexTaskEvent) => {
    for (const listener of [...listeners]) listener(event)
  }
  return { getInfo, readText, index, cancelIndex, onIndex, listeners, unsubscribes, alert, emit }
}

function resetStores() {
  useFileStore.getState().cancelLogIndex()
  useFileStore.setState({
    files: [],
    currentFile: null,
    mru: [],
    isLoading: false,
    logIndexTaskId: null,
    logIndexStatus: 'idle',
    logIndexError: null,
  })
  useEditorStore.setState({
    activeDocumentPath: null,
    documentSessions: {},
    content: '',
    isDirty: false,
    mode: 'text',
    logIndexedPath: null,
    logTotalLines: 0,
  })
  vi.clearAllMocks()
}

describe('log index lifecycle on document switch', () => {
  it('cancels the active index and resets to idle when switching to a smaller log', async () => {
    const api = installApi({ '/logs/big.log': LARGE_BYTES, '/logs/small.log': 100 })
    resetStores()

    await useFileStore.getState().openFile('/logs/big.log')
    await vi.waitFor(() =>
      expect(useFileStore.getState().logIndexTaskId).toBe('task:/logs/big.log'),
    )
    expect(useFileStore.getState().logIndexStatus).toBe('indexing')
    expect(api.index).toHaveBeenCalledWith('/logs/big.log')
    expect(api.unsubscribes).toHaveLength(1)

    await useFileStore.getState().openFile('/logs/small.log')

    expect(api.cancelIndex).toHaveBeenCalledWith('task:/logs/big.log')
    expect(api.unsubscribes[0]).toHaveBeenCalledOnce()
    expect(useFileStore.getState().currentFile).toBe('/logs/small.log')
    expect(useFileStore.getState().logIndexStatus).toBe('idle')
    expect(useFileStore.getState().logIndexTaskId).toBeNull()
    expect(useEditorStore.getState().content).toBe('# /logs/small.log')
    expect(api.index).toHaveBeenCalledTimes(1)
  })

  it('resets index state when switching from an indexing log to a plain file', async () => {
    const api = installApi({ '/logs/big.log': LARGE_BYTES, '/notes/plain.txt': 100 })
    resetStores()

    await useFileStore.getState().openFile('/logs/big.log')
    await vi.waitFor(() =>
      expect(useFileStore.getState().logIndexTaskId).toBe('task:/logs/big.log'),
    )

    await useFileStore.getState().openFile('/notes/plain.txt')

    expect(api.cancelIndex).toHaveBeenCalledWith('task:/logs/big.log')
    expect(useFileStore.getState().currentFile).toBe('/notes/plain.txt')
    expect(useFileStore.getState().logIndexStatus).toBe('idle')
    expect(useEditorStore.getState().logIndexedPath).toBeNull()
    expect(useEditorStore.getState().content).toBe('# /notes/plain.txt')
  })

  it('cancels the previous index when opening a second large log', async () => {
    const api = installApi({
      '/logs/first.log': LARGE_BYTES,
      '/logs/second.log': LARGE_BYTES,
    })
    resetStores()

    await useFileStore.getState().openFile('/logs/first.log')
    await vi.waitFor(() =>
      expect(useFileStore.getState().logIndexTaskId).toBe('task:/logs/first.log'),
    )

    await useFileStore.getState().openFile('/logs/second.log')
    await vi.waitFor(() =>
      expect(useFileStore.getState().logIndexTaskId).toBe('task:/logs/second.log'),
    )

    expect(api.cancelIndex).toHaveBeenCalledWith('task:/logs/first.log')
    expect(api.index).toHaveBeenCalledWith('/logs/second.log')
    expect(useFileStore.getState().currentFile).toBe('/logs/second.log')
    expect(useFileStore.getState().logIndexStatus).toBe('indexing')

    api.emit({
      taskId: 'task:/logs/second.log',
      status: 'complete',
      data: makePayload('/logs/second.log', 500),
    })
    expect(useFileStore.getState().logIndexStatus).toBe('complete')
    expect(useEditorStore.getState().logIndexedPath).toBe('/logs/second.log')
    expect(useEditorStore.getState().logTotalLines).toBe(500)
  })

  it('resets index state when the indexing log is closed', async () => {
    const api = installApi({ '/logs/big.log': LARGE_BYTES, '/notes/plain.txt': 100 })
    resetStores()

    await useFileStore.getState().openFile('/notes/plain.txt')
    await useFileStore.getState().openFile('/logs/big.log')
    await vi.waitFor(() =>
      expect(useFileStore.getState().logIndexTaskId).toBe('task:/logs/big.log'),
    )

    useFileStore.getState().removeFile('/logs/big.log')

    expect(api.cancelIndex).toHaveBeenCalledWith('task:/logs/big.log')
    expect(useFileStore.getState().currentFile).toBe('/notes/plain.txt')
    expect(useFileStore.getState().logIndexStatus).toBe('idle')
    expect(useEditorStore.getState().logIndexedPath).toBeNull()
  })

  it('ignores an index response that arrives after switching documents', async () => {
    let finishIndex: ((value: unknown) => void) | undefined
    const api = installApi(
      { '/logs/big.log': LARGE_BYTES, '/logs/small.log': 100 },
      {
        index: () =>
          new Promise((resolve) => {
            finishIndex = resolve
          }),
      },
    )
    resetStores()

    await useFileStore.getState().openFile('/logs/big.log')
    expect(useFileStore.getState().logIndexStatus).toBe('indexing')

    await useFileStore.getState().openFile('/logs/small.log')
    expect(useFileStore.getState().logIndexStatus).toBe('idle')
    expect(api.unsubscribes[0]).toHaveBeenCalledOnce()

    finishIndex?.({ success: true, data: { taskId: 'late-task' } })
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(api.cancelIndex).toHaveBeenCalledWith('late-task')
    expect(useFileStore.getState().logIndexStatus).toBe('idle')
    expect(useFileStore.getState().logIndexError).toBeNull()
  })
})
