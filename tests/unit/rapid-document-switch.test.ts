import { afterEach, describe, expect, it, vi } from 'vitest'
import '../../src/renderer/src/registry/builtinModes'
import { useEditorStore } from '../../src/renderer/src/stores/editorStore'
import { useFileStore } from '../../src/renderer/src/stores/fileStore'
import { registerUnsavedPrompt } from '../../src/renderer/src/utils/unsavedChangesGuard'

afterEach(() => vi.unstubAllGlobals())

function makeFileEntry(filePath: string) {
  return {
    path: filePath,
    name: filePath.split('/').pop() ?? filePath,
    size: 100,
    extension: filePath.slice(filePath.lastIndexOf('.')),
    lines: 1,
    encoding: 'utf8',
    active: false,
  }
}

function snapshotResponse(filePath: string, content: string) {
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

function resetStores() {
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
}

function installFileApi(
  readTextImpl: (filePath: string) => Promise<unknown> = async (filePath) =>
    snapshotResponse(filePath, `# ${filePath}`),
) {
  const getInfo = vi.fn(async (filePath: string) => ({
    success: true,
    data: { ...makeFileEntry(filePath), path: filePath },
  }))
  const readText = vi.fn((filePath: string) => readTextImpl(filePath))
  const reserve = vi.fn(async ({ filePath }: { filePath: string }) => ({
    success: true,
    data: { status: 'reserved', filePath, reservationId: `reservation:${filePath}` },
  }))
  const commit = vi.fn(async () => ({ success: true, data: { accepted: true } }))
  const release = vi.fn(async () => ({ success: true, data: { accepted: true } }))
  const open = vi.fn()
  const alert = vi.fn()
  vi.stubGlobal('window', {
    electronAPI: {
      file: { getInfo, readText, open, create: vi.fn() },
      document: { reserve, commit, release },
      recent: { record: vi.fn(async () => ({ success: true })) },
      backup: { discardSource: vi.fn(async () => ({ success: true, data: { discarded: 0 } })) },
      log: {
        index: vi.fn(async () => ({ success: true, data: { taskId: 'task' } })),
        cancelIndex: vi.fn(async () => ({ success: true, data: { cancelled: true } })),
        onIndex: vi.fn(() => () => undefined),
      },
    },
    confirm: vi.fn(() => true),
    alert,
  })
  return { getInfo, readText, open, reserve, commit, release, alert }
}

describe('rapid document switches', () => {
  it('keeps the final document after 20 switches and late out-of-order reads', async () => {
    const pending = new Map<string, (response: unknown) => void>()
    const readText = vi.fn(
      (filePath: string) => new Promise((resolve) => pending.set(filePath, resolve)),
    )
    vi.stubGlobal('window', {
      electronAPI: {
        file: {
          getInfo: vi.fn(async () => ({ success: true, data: { size: 100, lines: 1 } })),
          readText,
        },
      },
    })
    const makeFile = (filePath: string) => ({
      path: filePath,
      name: filePath,
      size: 100,
      extension: '.md',
      lines: 1,
      encoding: 'utf8',
      active: false,
    })
    useFileStore.setState({
      files: [makeFile('/a.md'), makeFile('/b.md')],
      currentFile: null,
      mru: [],
    })
    useEditorStore.setState({
      activeDocumentPath: null,
      documentSessions: {},
      content: '',
      isDirty: false,
    })
    const switches = Array.from({ length: 20 }, (_, index) =>
      useFileStore.getState().setCurrentFile(index % 2 === 0 ? '/a.md' : '/b.md'),
    )
    await vi.waitFor(() => {
      expect(pending.has('/a.md')).toBe(true)
      expect(pending.has('/b.md')).toBe(true)
    })
    const response = (filePath: string, content: string) => ({
      success: true,
      data: {
        filePath,
        content,
        encoding: 'utf8',
        lineEnding: 'lf',
        version: { mtimeMs: 1, size: content.length, contentHash: content },
        sampled: false,
      },
    })
    pending.get('/b.md')!(response('/b.md', '# final B'))
    await vi.waitFor(() => expect(useEditorStore.getState().content).toBe('# final B'))
    pending.get('/a.md')!(response('/a.md', '# stale A'))
    await Promise.all(switches)
    expect(useFileStore.getState().currentFile).toBe('/b.md')
    expect(useEditorStore.getState().content).toBe('# final B')
  })
})

describe('openFile request ordering', () => {
  it('keeps the later openFile request when the earlier read completes last', async () => {
    resetStores()
    let finishA: ((value: unknown) => void) | undefined
    const api = installFileApi((filePath) => {
      if (filePath.endsWith('/slow-a.md')) {
        return new Promise((resolve) => {
          finishA = resolve
        })
      }
      return Promise.resolve(snapshotResponse(filePath, '# Fast B'))
    })

    const openingA = useFileStore.getState().openFile('/ordering/slow-a.md')
    await vi.waitFor(() => expect(api.readText).toHaveBeenCalledWith('/ordering/slow-a.md'))
    const openingB = useFileStore.getState().openFile('/ordering/fast-b.md')
    await openingB

    expect(useFileStore.getState().currentFile).toBe('/ordering/fast-b.md')
    expect(useEditorStore.getState().content).toBe('# Fast B')

    finishA?.(snapshotResponse('/ordering/slow-a.md', '# Stale A'))
    await openingA

    expect(useFileStore.getState().currentFile).toBe('/ordering/fast-b.md')
    expect(useEditorStore.getState().content).toBe('# Fast B')
    expect(api.alert).not.toHaveBeenCalled()
    expect(api.release).toHaveBeenCalledWith({
      filePath: '/ordering/slow-a.md',
      reservationId: 'reservation:/ordering/slow-a.md',
    })
    expect(useFileStore.getState().files.map((file) => file.path)).toEqual(['/ordering/fast-b.md'])
    expect(useEditorStore.getState().documentSessions['/ordering/slow-a.md']).toBeUndefined()
  })

  it('abandons an earlier openFile request when the later read completes last', async () => {
    resetStores()
    const pending = new Map<string, (value: unknown) => void>()
    const api = installFileApi(
      (filePath) =>
        new Promise((resolve) => {
          pending.set(filePath, resolve)
        }),
    )

    const openingA = useFileStore.getState().openFile('/ordering/slow-a.md')
    await vi.waitFor(() => expect(pending.has('/ordering/slow-a.md')).toBe(true))
    const openingB = useFileStore.getState().openFile('/ordering/slow-b.md')
    await vi.waitFor(() => expect(pending.has('/ordering/slow-b.md')).toBe(true))

    pending.get('/ordering/slow-a.md')!(snapshotResponse('/ordering/slow-a.md', '# A'))
    await openingA
    expect(useFileStore.getState().currentFile).not.toBe('/ordering/slow-a.md')

    pending.get('/ordering/slow-b.md')!(snapshotResponse('/ordering/slow-b.md', '# B'))
    await openingB

    expect(useFileStore.getState().currentFile).toBe('/ordering/slow-b.md')
    expect(useEditorStore.getState().content).toBe('# B')
    expect(api.alert).not.toHaveBeenCalled()
    expect(api.release).toHaveBeenCalledWith({
      filePath: '/ordering/slow-a.md',
      reservationId: 'reservation:/ordering/slow-a.md',
    })
  })

  it('keeps the final request after 20 out-of-order openFile completions', async () => {
    resetStores()
    const paths = Array.from({ length: 20 }, (_, index) => `/rapid/doc-${index}.md`)
    const pending = new Map<string, (value: unknown) => void>()
    const api = installFileApi(
      (filePath) =>
        new Promise((resolve) => {
          pending.set(filePath, resolve)
        }),
    )

    const openings: Promise<void>[] = []
    for (const filePath of paths) {
      openings.push(useFileStore.getState().openFile(filePath))
      await vi.waitFor(() => expect(pending.has(filePath)).toBe(true))
    }

    const completionOrder = [5, 12, 19, 0, 7, 3, 18, 1, 9, 14, 2, 11, 6, 16, 4, 13, 8, 17, 10, 15]
    for (const index of completionOrder) {
      pending.get(paths[index])?.(snapshotResponse(paths[index], `# doc ${index}`))
    }
    await Promise.all(openings)

    expect(useFileStore.getState().currentFile).toBe(paths[19])
    expect(useEditorStore.getState().content).toBe('# doc 19')
    expect(useFileStore.getState().files.map((file) => file.path)).toEqual([paths[19]])
    expect(api.alert).not.toHaveBeenCalled()
  })

  it('lets the latest open request win while an unsaved confirmation is pending', async () => {
    resetStores()
    const api = installFileApi(async (filePath) => snapshotResponse(filePath, `# ${filePath}`))
    const source = '/pending/source.md'
    useFileStore.setState({ files: [makeFileEntry(source)], currentFile: source, mru: [source] })
    useEditorStore.getState().setDocumentSnapshot(source, snapshotResponse(source, '# Source').data)
    useEditorStore.getState().setContent('# Unsaved source')

    let resolvePrompt: ((decision: 'discard') => void) | undefined
    const decision = new Promise<'discard'>((resolve) => {
      resolvePrompt = resolve
    })
    let promptCalls = 0
    const unregister = registerUnsavedPrompt(() => {
      promptCalls++
      return decision
    })

    const first = useFileStore.getState().openFile('/pending/first.md')
    await vi.waitFor(() => expect(promptCalls).toBe(1))
    const second = useFileStore.getState().openFile('/pending/second.md')
    await vi.waitFor(() => expect(api.readText).toHaveBeenCalledWith('/pending/second.md'))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(promptCalls).toBe(1)

    resolvePrompt?.('discard')
    await Promise.all([first, second])

    expect(useFileStore.getState().currentFile).toBe('/pending/second.md')
    expect(useEditorStore.getState().content).toBe('# /pending/second.md')
    expect(api.alert).not.toHaveBeenCalled()
    expect(useFileStore.getState().files.map((file) => file.path)).toEqual([
      source,
      '/pending/second.md',
    ])
    expect(useEditorStore.getState().documentSessions[source]).toBeUndefined()
    unregister()
  })

  it('keeps the original document when the unsaved confirmation is cancelled', async () => {
    resetStores()
    const api = installFileApi()
    const source = '/pending/cancel.md'
    useFileStore.setState({ files: [makeFileEntry(source)], currentFile: source, mru: [source] })
    useEditorStore.getState().setDocumentSnapshot(source, snapshotResponse(source, '# Source').data)
    useEditorStore.getState().setContent('# Unsaved source')

    const unregister = registerUnsavedPrompt(async () => 'cancel')
    await useFileStore.getState().openFile('/pending/other.md')

    expect(useFileStore.getState().currentFile).toBe(source)
    expect(useEditorStore.getState().content).toBe('# Unsaved source')
    expect(useFileStore.getState().files.map((file) => file.path)).toEqual([source])
    expect(api.alert).not.toHaveBeenCalled()
    expect(api.release).toHaveBeenCalledWith({
      filePath: '/pending/other.md',
      reservationId: 'reservation:/pending/other.md',
    })
    unregister()
  })

  it('reopens the same path after the earlier open aborts at the unsaved prompt', async () => {
    resetStores()
    const api = installFileApi(async (filePath) => snapshotResponse(filePath, `# ${filePath}`))
    let reservationCount = 0
    api.reserve.mockImplementation(async ({ filePath }: { filePath: string }) => ({
      success: true,
      data: { status: 'reserved', filePath, reservationId: `reservation-${++reservationCount}` },
    }))
    const source = '/same-path/source.md'
    const target = '/same-path/target.md'
    useFileStore.setState({ files: [makeFileEntry(source)], currentFile: source, mru: [source] })
    useEditorStore.getState().setDocumentSnapshot(source, snapshotResponse(source, '# Source').data)
    useEditorStore.getState().setContent('# Unsaved source')

    let resolvePrompt: ((decision: 'discard') => void) | undefined
    const decision = new Promise<'discard'>((resolve) => {
      resolvePrompt = resolve
    })
    let promptCalls = 0
    const unregister = registerUnsavedPrompt(() => {
      promptCalls++
      return decision
    })

    const first = useFileStore.getState().openFile(target)
    await vi.waitFor(() => expect(promptCalls).toBe(1))
    expect(useFileStore.getState().files.map((file) => file.path)).toContain(target)

    const second = useFileStore.getState().openFile(target)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(api.reserve).toHaveBeenCalledTimes(1)

    resolvePrompt?.('discard')
    await Promise.all([first, second])

    expect(useFileStore.getState().currentFile).toBe(target)
    expect(useEditorStore.getState().content).toBe(`# ${target}`)
    expect(useFileStore.getState().files.map((file) => file.path)).toEqual([source, target])
    expect(api.alert).not.toHaveBeenCalled()
    expect(api.reserve).toHaveBeenCalledTimes(2)
    expect(api.reserve.mock.calls.every(([request]) => request.filePath === target)).toBe(true)
    expect(api.commit).toHaveBeenCalledTimes(1)
    expect(api.commit.mock.calls[0]?.[0]).toEqual({
      filePath: target,
      reservationId: 'reservation-2',
    })
    expect(api.release).toHaveBeenCalledWith({ filePath: target, reservationId: 'reservation-1' })

    // The surviving file keeps its reservation: closing it must release the reopened credential.
    useFileStore.getState().removeFile(target)
    expect(useFileStore.getState().files.map((file) => file.path)).toEqual([source])
    expect(api.release).toHaveBeenCalledWith({ filePath: target, reservationId: 'reservation-2' })
    await vi.waitFor(() => expect(useEditorStore.getState().content).toBe(`# ${source}`))
    unregister()
  })

  it('does not abandon an in-flight open when the native dialog is cancelled', async () => {
    resetStores()
    let resolveRead: ((response: unknown) => void) | undefined
    const api = installFileApi(
      () =>
        new Promise((resolve) => {
          resolveRead = resolve
        }),
    )
    api.open.mockResolvedValue({ success: false, cancelled: true })

    const pendingOpen = useFileStore.getState().openFile('/dialog/in-flight.md')
    await vi.waitFor(() => expect(api.readText).toHaveBeenCalledWith('/dialog/in-flight.md'))
    await useFileStore.getState().openFile()

    resolveRead?.(snapshotResponse('/dialog/in-flight.md', '# In flight'))
    await pendingOpen

    expect(useFileStore.getState().currentFile).toBe('/dialog/in-flight.md')
    expect(useEditorStore.getState().content).toBe('# In flight')
    expect(api.reserve).toHaveBeenCalledTimes(1)
    expect(api.commit).toHaveBeenCalledTimes(1)
    expect(api.alert).not.toHaveBeenCalled()
  })

  it('does not let a late dialog result override a newer open request', async () => {
    resetStores()
    const api = installFileApi()
    const dialogs: Array<(value: unknown) => void> = []
    api.open.mockImplementation(
      () =>
        new Promise((resolve) => {
          dialogs.push(resolve)
        }),
    )

    const earlier = useFileStore.getState().openFile()
    const later = useFileStore.getState().openFile()
    await vi.waitFor(() => expect(dialogs).toHaveLength(2))
    dialogs[1]?.({ success: true, data: '/dialog/later.md' })
    dialogs[0]?.({ success: true, data: '/dialog/earlier.md' })
    await Promise.all([earlier, later])

    expect(useFileStore.getState().currentFile).toBe('/dialog/later.md')
    expect(api.reserve).toHaveBeenCalledTimes(1)
    expect(api.reserve).toHaveBeenCalledWith({ filePath: '/dialog/later.md', purpose: 'open' })
    expect(api.alert).not.toHaveBeenCalled()
  })

  it('releases a supplied credential when the duplicate switch throws', async () => {
    resetStores()
    const api = installFileApi()
    const source = '/duplicate/source.md'
    const target = '/duplicate/target.md'
    useFileStore.setState({
      files: [makeFileEntry(source), makeFileEntry(target)],
      currentFile: source,
      mru: [source, target],
    })
    const supplied = { filePath: target, reservationId: 'supplied-duplicate' }
    const originalSetCurrentFile = useFileStore.getState().setCurrentFile
    const switchSpy = vi
      .spyOn(useFileStore.getState(), 'setCurrentFile')
      .mockRejectedValueOnce(new Error('switch failed'))

    try {
      await useFileStore.getState().openFile(target, supplied)
    } finally {
      switchSpy.mockRestore()
      useFileStore.setState({ setCurrentFile: originalSetCurrentFile })
    }

    expect(api.release).toHaveBeenCalledWith(supplied)
    expect(api.reserve).not.toHaveBeenCalled()
    expect(api.commit).not.toHaveBeenCalled()
  })
})
