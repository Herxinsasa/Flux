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

type OverlayView = 'none' | 'settings' | 'skills' | 'help'

export function AppShell() {
  const files = useFileStore((s) => s.files)
  const hasFiles = files.length > 0
  const { importFiles } = useFileImport()
  const { load: loadSettings, applyWorkspaceSupplierFromConfig } = useProvider()
  const workspaceRoot = useFileStore((s) => s.workspaceRoot)
  const workspaceConfig = useFileStore((s) => s.workspaceConfig)
  const workspaceOpenNonce = useFileStore((s) => s.workspaceOpenNonce)
  const [globalToast, setGlobalToast] = useState<FluxToastState | null>(null)
  const [overlay, setOverlay] = useState<OverlayView>('none')
  const [aboutOpen, setAboutOpen] = useState(false)
  const [appVersion, setAppVersion] = useState('1.0.0')

  const sidebarWidth = useLayoutStore((s) => s.sidebarWidth)
  const chatWidth = useLayoutStore((s) => s.chatWidth)
  const setSidebarWidth = useLayoutStore((s) => s.setSidebarWidth)
  const setChatWidth = useLayoutStore((s) => s.setChatWidth)
  const sidebarDragStart = useRef(sidebarWidth)
  const chatDragStart = useRef(chatWidth)
  const toggleTheme = useSettingsStore((s) => s.toggleTheme)

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

  /** 打开工作区后：合并磁盘供应商配置，并在已完成设置时自动测通一次 */
  useEffect(() => {
    if (!workspaceRoot || workspaceOpenNonce === 0) return

    void (async () => {
      await loadSettings()
      if (workspaceConfig) {
        applyWorkspaceSupplierFromConfig(workspaceConfig)
      }
      const res = (await window.electronAPI.settings.workspaceVerify(workspaceRoot)) as {
        skipped?: boolean
        success?: boolean
        error?: string
      }
      if (res?.skipped) return
      if (res?.success) {
        setGlobalToast({ variant: 'success', message: '连接成功' })
      } else {
        setGlobalToast({ variant: 'error', message: '连接失败，请检查配置' })
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

  // Settings overlay mode — replace the full view
  if (overlay === 'settings') {
    return (
      <>
        <div className="flex flex-col h-screen bg-[var(--bg-primary)] text-[var(--text-primary)] font-[var(--font-ui)]">
          <SettingsView onBack={handleBack} />
        </div>
        <FluxToast toast={globalToast} onDismiss={() => setGlobalToast(null)} />
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
          />

          {/* 三栏可拖拽；中间 flex:1 全屏/最大化时由中间吃掉增量，两侧保持当前像素宽度 */}
          <div className="flex flex-1 min-h-0 min-w-0 overflow-hidden">
            <div
              className="shrink-0 flex flex-col min-h-0 border-r border-[var(--border-subtle)]"
              style={{ width: sidebarWidth }}
            >
              <ErrorBoundary panelName="Sidebar">
                <Sidebar
                  onNavigateToSettings={handleNavigateToSettings}
                  onNavigateToSkills={handleNavigateToSkills}
                />
              </ErrorBoundary>
            </div>

            <VerticalResizeHandle
              onResizeStart={() => {
                sidebarDragStart.current = useLayoutStore.getState().sidebarWidth
              }}
              onResize={(dx) => setSidebarWidth(sidebarDragStart.current + dx)}
            />

            <main className="flex-1 min-w-[200px] flex flex-col min-h-0 overflow-hidden border-r border-[var(--border-subtle)]">
              <ErrorBoundary panelName="Editor">
                {hasFiles ? <EditorRouter /> : <DropZone />}
              </ErrorBoundary>
            </main>

            <VerticalResizeHandle
              onResizeStart={() => {
                chatDragStart.current = useLayoutStore.getState().chatWidth
              }}
              /* 分隔条在聊天栏左侧：向右拖应加宽聊天区，与指针位移同向需减去 dx（此前方向反了） */
              onResize={(dx) => setChatWidth(chatDragStart.current - dx)}
            />

            <div className="shrink-0 flex flex-col h-full min-h-0 min-w-0" style={{ width: chatWidth }}>
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
    </>
  )
}
