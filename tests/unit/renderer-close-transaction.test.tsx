import { cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  close: null as any,
  cancelled: null as any,
  result: vi.fn(),
  flush: vi.fn(),
}))
vi.mock('../../src/renderer/src/components/ErrorBoundary', () => ({
  ErrorBoundary: ({ children }: any) => children,
}))
vi.mock('../../src/renderer/src/components/layout/TitleBar', () => ({ TitleBar: () => null }))
vi.mock('../../src/renderer/src/components/layout/Sidebar', () => ({ Sidebar: () => null }))
vi.mock('../../src/renderer/src/components/layout/StatusBar', () => ({ StatusBar: () => null }))
vi.mock('../../src/renderer/src/components/layout/VerticalResizeHandle', () => ({
  VerticalResizeHandle: () => null,
}))
vi.mock('../../src/renderer/src/components/common/FluxToast', () => ({ FluxToast: () => null }))
vi.mock('../../src/renderer/src/components/common/DropZone', () => ({ DropZone: () => null }))
vi.mock('../../src/renderer/src/components/FileImporter', () => ({
  FileImporter: ({ children }: any) => children,
}))
vi.mock('../../src/renderer/src/components/chat/ChatPanel', () => ({ ChatPanel: () => null }))
vi.mock('../../src/renderer/src/components/settings/SettingsView', () => ({
  SettingsView: () => null,
}))
vi.mock('../../src/renderer/src/components/skill/SkillPanel', () => ({ SkillPanel: () => null }))
vi.mock('../../src/renderer/src/components/help/HelpView', () => ({ HelpView: () => null }))
vi.mock('../../src/renderer/src/components/help/AboutDialog', () => ({ AboutDialog: () => null }))
vi.mock('../../src/renderer/src/components/review/ReviewPanel', () => ({ ReviewPanel: () => null }))
vi.mock('../../src/renderer/src/components/common/RecoveryBar', () => ({ RecoveryBar: () => null }))
vi.mock('../../src/renderer/src/components/common/UnsavedChangesDialog', () => ({
  UnsavedChangesDialog: () => null,
}))
vi.mock('../../src/renderer/src/registry/EditorRouter', () => ({ EditorRouter: () => null }))
vi.mock('../../src/renderer/src/hooks/useFileImport', () => ({
  useFileImport: () => ({ importFiles: vi.fn() }),
}))
vi.mock('../../src/renderer/src/hooks/useProvider', () => ({
  useProvider: () => ({ load: vi.fn() }),
}))
vi.mock('../../src/renderer/src/hooks/useShortcuts', () => ({ useShortcuts: vi.fn() }))
vi.mock('../../src/renderer/src/hooks/useBackupScheduler', () => ({
  useBackupScheduler: () => null,
}))
vi.mock('../../src/renderer/src/utils/editorDraftBuffer', () => ({
  flushPendingEditorDraft: mocks.flush,
}))
vi.mock('../../src/renderer/src/stores/layoutStore', () => ({
  useLayoutStore: (select: any) =>
    select({
      sidebarWidth: 200,
      chatWidth: 200,
      sidebarVisible: true,
      chatVisible: false,
      minimalMode: false,
      setSidebarWidth: vi.fn(),
      setChatWidth: vi.fn(),
      toggleChat: vi.fn(),
      toggleSidebar: vi.fn(),
    }),
}))
vi.mock('../../src/renderer/src/stores/fileStore', () => {
  const store: any = (select: any) => select({ files: [], currentFile: null })
  store.getState = () => ({ workspaceRoot: null })
  return { useFileStore: store }
})
vi.mock('../../src/renderer/src/stores/settingsStore', () => {
  const store: any = (select: any) => select({ toggleTheme: vi.fn() })
  store.getState = () => ({ applyAppearance: vi.fn() })
  return { useSettingsStore: store }
})
vi.mock('../../src/renderer/src/stores/editorStore', () => ({
  normalizeDocumentPath: (value: string) => value,
  useEditorStore: (select: any) =>
    select({ content: '', activeDocumentPath: null, editorHydrationEpoch: 0 }),
}))
vi.mock('../../src/renderer/src/stores/reviewStore', () => {
  const store: any = (select: any) =>
    select({ panelOpen: false, panelWidth: 200, setPanelWidth: vi.fn(), documents: {} })
  store.getState = () => ({ panelOpen: false, closePanel: vi.fn(), togglePanel: vi.fn() })
  return { useReviewStore: store }
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  mocks.close = null
  mocks.cancelled = null
})

describe('renderer close transaction', () => {
  it('ignores a cancelled freeze and waits for active file work before acknowledging the next freeze', async () => {
    const unsubscribe = () => undefined
    Object.defineProperty(window, 'electronAPI', {
      configurable: true,
      value: {
        app: {
          onOpenFile: () => unsubscribe,
          onCloseCancelled: (callback: any) => {
            mocks.cancelled = callback
            return unsubscribe
          },
          onCoordinatedClose: (callback: any) => {
            mocks.close = callback
            return unsubscribe
          },
          closeResult: mocks.result,
          getVersion: async () => ({ success: true, data: { version: '1' } }),
        },
        window: {
          onInitialize: () => unsubscribe,
          onWorkspaceQuery: () => unsubscribe,
          ready: async () => ({ success: true }),
        },
        document: { onOpenReserved: () => unsubscribe },
        appearance: { onChanged: () => unsubscribe },
      },
    })
    const { AppShell } = await import('../../src/renderer/src/components/layout/AppShell')
    render(<AppShell />)
    await waitFor(() => expect(mocks.close).toBeTypeOf('function'))
    mocks.cancelled({ requestId: 'cancelled' })
    mocks.close({ requestId: 'cancelled', scope: 'application', phase: 'freeze' })
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(mocks.flush).not.toHaveBeenCalled()
    expect(mocks.result).not.toHaveBeenCalled()
    const { beginDocumentOperation } =
      await import('../../src/renderer/src/utils/documentOperations')
    const finish = beginDocumentOperation()
    expect(finish).not.toBeNull()
    mocks.close({ requestId: 'active', scope: 'application', phase: 'freeze' })
    expect(mocks.flush).toHaveBeenCalled()
    expect(beginDocumentOperation()).toBeNull()
    expect(mocks.result).not.toHaveBeenCalled()
    finish!()
    await waitFor(() =>
      expect(mocks.result).toHaveBeenCalledWith({ requestId: 'active', result: 'frozen' }),
    )
  })
})
