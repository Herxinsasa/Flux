import { useState, useCallback, useEffect, useRef } from 'react'
import { ErrorBoundary } from '../ErrorBoundary'
import { TitleBar } from './TitleBar'
import { Sidebar } from './Sidebar'
import { StatusBar } from './StatusBar'
import { VerticalResizeHandle } from './VerticalResizeHandle'
import { FluxToast, type FluxToastState } from '../common/FluxToast'
import { useLayoutStore } from '../../stores/layoutStore'
import { EditorRouter } from '../../registry/EditorRouter'
import { DropZone } from '../common/DropZone'
import { FileImporter } from '../FileImporter'
import { ChatPanel } from '../chat/ChatPanel'
import { SettingsView } from '../settings/SettingsView'
import { SkillPanel } from '../skill/SkillPanel'
import { HelpView } from '../help/HelpView'
import { AboutDialog } from '../help/AboutDialog'
import { useFileStore } from '../../stores/fileStore'
import { useFileImport } from '../../hooks/useFileImport'
import { useProvider } from '../../hooks/useProvider'
import { useShortcuts } from '../../hooks/useShortcuts'
import { useSettingsStore } from '../../stores/settingsStore'
import { normalizeDocumentPath, useEditorStore } from '../../stores/editorStore'
import { useReviewStore } from '../../stores/reviewStore'
import { ReviewPanel } from '../review/ReviewPanel'
import { useBackupScheduler } from '../../hooks/useBackupScheduler'
import { RecoveryBar } from '../common/RecoveryBar'
import { UnsavedChangesDialog } from '../common/UnsavedChangesDialog'
import {
  confirmUnsavedDocument,
  listDirtyDocumentPaths,
  registerUnsavedPrompt,
  type UnsavedDecision,
} from '../../utils/unsavedChangesGuard'
import { saveDocument } from '../../utils/documentSave'

type OverlayView = 'none' | 'settings' | 'skills' | 'help'

export function AppShell() {
  const backupWarning = useBackupScheduler()
  const files = useFileStore((s) => s.files)
  const hasFiles = files.length > 0
  const { importFiles } = useFileImport()
  const { load: loadSettings, applyWorkspaceSupplierFromConfig } = useProvider()
  const workspaceRoot = useFileStore((s) => s.workspaceRoot)
  const workspaceConfig = useFileStore((s) => s.workspaceConfig)
  const workspaceOpenNonce = useFileStore((s) => s.workspaceOpenNonce)
  const [globalToast, setGlobalToast] = useState<FluxToastState | null>(null)

  useEffect(() => {
    if (backupWarning) setGlobalToast({ message: backupWarning, variant: 'error' })
  }, [backupWarning])
  const [overlay, setOverlay] = useState<OverlayView>('none')
  const [aboutOpen, setAboutOpen] = useState(false)
  const [appVersion, setAppVersion] = useState('1.0.0')
  const [unsavedPrompt, setUnsavedPrompt] = useState<{
    filePath: string
    resolve: (decision: UnsavedDecision) => void
  } | null>(null)
  const promptActiveRef = useRef(false)
  const [unsavedSaving, setUnsavedSaving] = useState(false)

  const sidebarWidth = useLayoutStore((s) => s.sidebarWidth)
  const chatWidth = useLayoutStore((s) => s.chatWidth)
  const sidebarVisible = useLayoutStore((s) => s.sidebarVisible)
  const chatVisible = useLayoutStore((s) => s.chatVisible)
  const minimalMode = useLayoutStore((s) => s.minimalMode)
  const setSidebarWidth = useLayoutStore((s) => s.setSidebarWidth)
  const setChatWidth = useLayoutStore((s) => s.setChatWidth)
  const sidebarDragStart = useRef(sidebarWidth)
  const chatDragStart = useRef(chatWidth)
  const toggleTheme = useSettingsStore((s) => s.toggleTheme)
  const toggleChat = useLayoutStore((s) => s.toggleChat)
  const toggleSidebar = useLayoutStore((s) => s.toggleSidebar)
  const currentFile = useFileStore((s) => s.currentFile)
  const editorContent = useEditorStore((s) => s.content)
  const activeDocumentPath = useEditorStore((s) => s.activeDocumentPath)
  const editorHydrationEpoch = useEditorStore((s) => s.editorHydrationEpoch)
  const reviewOpen = useReviewStore((s) => s.panelOpen)
  const reviewWidth = useReviewStore((s) => s.panelWidth)
  const reviewCount = useReviewStore((s) => {
    if (!currentFile) return 0
    const document = s.documents[normalizeDocumentPath(currentFile)]
    return document?.sidecar.comments.filter((comment) => comment.status === 'open').length ?? 0
  })
  const setReviewWidth = useReviewStore((s) => s.setPanelWidth)
  const reviewDragStart = useRef(reviewWidth)

  useEffect(() => window.electronAPI.app.onOpenFile((filePath) => {
    // 双击文档启动：加载文件所在工作区并打开文档
    void useFileStore.getState().openFileFromLaunch(filePath)
  }), [])

  useEffect(() => registerUnsavedPrompt((filePath) => new Promise((resolve) => {
    if (promptActiveRef.current) {
      resolve('cancel')
      return
    }
    promptActiveRef.current = true
    setUnsavedPrompt({ filePath, resolve })
  })), [])

  const resolveUnsavedPrompt = useCallback((decision: UnsavedDecision) => {
    const pending = unsavedPrompt
    if (!pending) return
    promptActiveRef.current = false
    setUnsavedSaving(false)
    setUnsavedPrompt(null)
    pending.resolve(decision)
  }, [unsavedPrompt])

  const saveUnsavedDocument = useCallback(async () => {
    if (!unsavedPrompt || unsavedSaving) return
    setUnsavedSaving(true)
    const saved = await saveDocument(unsavedPrompt.filePath)
    if (saved) resolveUnsavedPrompt('saved')
    else setUnsavedSaving(false)
  }, [resolveUnsavedPrompt, unsavedPrompt, unsavedSaving])

  useEffect(() => window.electronAPI.app.onCloseRequest(() => {
    void (async () => {
      for (const filePath of listDirtyDocumentPaths()) {
        if (!(await confirmUnsavedDocument(filePath))) return
      }
      window.electronAPI.app.approveClose()
    })()
  }), [])

  useEffect(() => {
    if (!currentFile || activeDocumentPath !== normalizeDocumentPath(currentFile)) return
    void useReviewStore.getState().loadDocument(currentFile, editorContent)
  }, [activeDocumentPath, currentFile, editorHydrationEpoch])

  const handleToggleReview = useCallback(() => {
    const opening = !useReviewStore.getState().panelOpen
    if (opening && useLayoutStore.getState().chatVisible) toggleChat()
    useReviewStore.getState().togglePanel()
  }, [toggleChat])

  const handleToggleChat = useCallback(() => {
    if (!useLayoutStore.getState().chatVisible && useReviewStore.getState().panelOpen) useReviewStore.getState().closePanel()
    toggleChat()
  }, [toggleChat])

  // Register global keyboard shortcuts
  useShortcuts()

  useEffect(() => {
    void (async () => {
      const res = await window.electronAPI.app.getVersion()
      if (res?.success && res.data?.version) {
        setAppVersion(res.data.version)
      }
    })()
  }, [])

  // Load settings configuration from main process on startup
  useEffect(() => {
    loadSettings()
  }, [loadSettings])

  /** 打开工作区后：合并磁盘供应商配置。AI 为增强功能，不自动测试连接、不弹提示，避免无配置时干扰 */
  useEffect(() => {
    if (!workspaceRoot || workspaceOpenNonce === 0) return

    void (async () => {
      await loadSettings()
      if (workspaceConfig) {
        applyWorkspaceSupplierFromConfig(workspaceConfig)
      }
    })()
  }, [
    workspaceOpenNonce,
    workspaceRoot,
    workspaceConfig,
    loadSettings,
    applyWorkspaceSupplierFromConfig,
  ])

  const handleFilesDrop = useCallback(
    async (paths: string[]) => {
      await importFiles(paths)
    },
    [importFiles],
  )

  const handleNavigateToSettings = useCallback(() => {
    setOverlay('settings')
  }, [])

  const handleNavigateToSkills = useCallback(() => {
    setOverlay('skills')
  }, [])

  const handleNavigateToHelp = useCallback(() => {
    setOverlay('help')
  }, [])

  const handleOpenAbout = useCallback(() => {
    setAboutOpen(true)
  }, [])

  const handleBack = useCallback(() => {
    setOverlay('none')
  }, [])

  const handleToggleTheme = useCallback(() => {
    toggleTheme()
    const t = useSettingsStore.getState().theme
    void window.electronAPI.settings.save({ theme: t })
  }, [toggleTheme])

  const unsavedDialog = (
    <UnsavedChangesDialog
      visible={!!unsavedPrompt}
      fileName={unsavedPrompt?.filePath.split(/[/\\]/).pop()}
      onSave={() => void saveUnsavedDocument()}
      onDiscard={() => resolveUnsavedPrompt('discard')}
      onCancel={() => resolveUnsavedPrompt('cancel')}
      isLoading={unsavedSaving}
    />
  )

  // Settings overlay mode — replace the full view
  if (overlay === 'settings') {
    return (
      <>
        <div className="flex flex-col h-screen bg-[var(--bg-primary)] text-[var(--text-primary)] font-[var(--font-ui)]">
          <SettingsView onBack={handleBack} />
        </div>
        <FluxToast toast={globalToast} onDismiss={() => setGlobalToast(null)} />
        {unsavedDialog}
      </>
    )
  }

  // Skills overlay mode
  if (overlay === 'skills') {
    return (
      <>
        <div className="flex flex-col h-screen bg-[var(--bg-primary)] text-[var(--text-primary)] font-[var(--font-ui)]">
          <SkillPanel onBack={handleBack} />
        </div>
        <FluxToast toast={globalToast} onDismiss={() => setGlobalToast(null)} />
        {unsavedDialog}
      </>
    )
  }

  // Help overlay mode
  if (overlay === 'help') {
    return (
      <>
        <div className="flex flex-col h-screen bg-[var(--bg-primary)] text-[var(--text-primary)] font-[var(--font-ui)]">
          <HelpView onBack={handleBack} />
        </div>
        <FluxToast toast={globalToast} onDismiss={() => setGlobalToast(null)} />
        {unsavedDialog}
      </>
    )
  }

  return (
    <>
      <FileImporter onFilesDrop={handleFilesDrop}>
        <div className="flex flex-col h-screen bg-[var(--bg-primary)] text-[var(--text-primary)] font-[var(--font-ui)]">
          <TitleBar
            onOpenSettings={handleNavigateToSettings}
            onOpenSkills={handleNavigateToSkills}
            onOpenHelp={handleNavigateToHelp}
            onOpenAbout={handleOpenAbout}
            onToggleTheme={handleToggleTheme}
            onToggleWorkspace={toggleSidebar}
            workspaceVisible={sidebarVisible && !minimalMode}
            onToggleChat={handleToggleChat}
            chatVisible={chatVisible && !minimalMode}
            onToggleReview={handleToggleReview}
            reviewVisible={reviewOpen && !minimalMode}
            reviewCount={reviewCount}
          />

          {/* 三栏可拖拽；中间 flex:1 全屏/最大化时由中间吃掉增量，两侧保持当前像素宽度 */}
          <div className="flex flex-1 min-h-0 min-w-0 overflow-hidden">
            <div
              className="shrink-0 flex flex-col min-h-0 border-r border-[var(--border-subtle)] overflow-hidden"
              style={{ width: minimalMode || !sidebarVisible ? 0 : sidebarWidth }}
            >
              <ErrorBoundary panelName="Sidebar">
                <Sidebar
                  onNavigateToSettings={handleNavigateToSettings}
                  onNavigateToSkills={handleNavigateToSkills}
                />
              </ErrorBoundary>
            </div>

            {!minimalMode && sidebarVisible && <VerticalResizeHandle
              onResizeStart={() => {
                sidebarDragStart.current = useLayoutStore.getState().sidebarWidth
              }}
              onResize={(dx) => setSidebarWidth(sidebarDragStart.current + dx)}
            />}

            <main className="flex-1 min-w-[200px] flex flex-col min-h-0 overflow-hidden border-r border-[var(--border-subtle)]">
              <RecoveryBar sourcePath={currentFile} />
              <ErrorBoundary panelName="Editor">
                {hasFiles ? <EditorRouter /> : <DropZone />}
              </ErrorBoundary>
            </main>

            {!minimalMode && (reviewOpen || chatVisible) && <VerticalResizeHandle
              onResizeStart={() => {
                if (reviewOpen) reviewDragStart.current = useReviewStore.getState().panelWidth
                else chatDragStart.current = useLayoutStore.getState().chatWidth
              }}
              /* 分隔条在聊天栏左侧：向右拖应加宽聊天区，与指针位移同向需减去 dx（此前方向反了） */
              onResize={(dx) => reviewOpen ? setReviewWidth(reviewDragStart.current - dx) : setChatWidth(chatDragStart.current - dx)}
            />}

            <div className="shrink-0 flex flex-col h-full min-h-0 min-w-0 overflow-hidden" style={{ width: minimalMode || !reviewOpen ? 0 : reviewWidth }} aria-hidden={minimalMode || !reviewOpen}>
              {reviewOpen && <ErrorBoundary panelName="Review"><ReviewPanel /></ErrorBoundary>}
            </div>

            <div
              className="shrink-0 flex flex-col h-full min-h-0 min-w-0 overflow-hidden"
              style={{ width: minimalMode || !chatVisible || reviewOpen ? 0 : chatWidth }}
              aria-hidden={minimalMode || !chatVisible || reviewOpen}
            >
              <ErrorBoundary panelName="Chat">
                <ChatPanel onNavigateToSettings={handleNavigateToSettings} />
              </ErrorBoundary>
            </div>
          </div>

          <ErrorBoundary panelName="StatusBar">
            <StatusBar />
          </ErrorBoundary>
        </div>
      </FileImporter>
      <AboutDialog open={aboutOpen} version={appVersion} onClose={() => setAboutOpen(false)} />
      <FluxToast toast={globalToast} onDismiss={() => setGlobalToast(null)} />
      {unsavedDialog}
    </>
  )
}
