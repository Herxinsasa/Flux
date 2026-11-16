import { existsSync } from 'fs'
import { app, BrowserWindow, Menu, shell } from 'electron'
import { join } from 'path'
import { registerAllHandlers } from './ipc/index'
import log from './logger'
import { setupErrorHandlers } from './error-handler'
import { registerLocalFileProtocol } from './local-file-protocol'
import { syncNativeChromeTheme } from './native-theme'
import store from './store/index'
import { SkillManager } from './skill/skill-manager'
import { extractOpenFilePath } from '../shared/launch-file'
import { WindowCoordinator } from './window-coordinator'
import { CloseCoordinator } from './close-coordinator'

const pendingOpenFiles: Array<string | null> = []
let isReady = false
let isFlushing = false
const windowCoordinator = new WindowCoordinator(createWindow)
const closeCoordinator = new CloseCoordinator((value) => windowCoordinator.setShuttingDown(value))

function flushPendingOpenFiles(): void {
  if (!isReady || isFlushing) return
  isFlushing = true
  void (async () => {
    try {
      while (pendingOpenFiles.length > 0) {
        const filePath = pendingOpenFiles.shift()
        await windowCoordinator.createFromLatest(filePath ?? undefined)
      }
    } finally {
      isFlushing = false
      if (pendingOpenFiles.length > 0) flushPendingOpenFiles()
    }
  })()
}

function enqueueOpenFile(commandLine: string[], workingDirectory = process.cwd()): void {
  const filePath = extractOpenFilePath(commandLine.slice(1), workingDirectory)
  pendingOpenFiles.push(filePath ?? null)
  flushPendingOpenFiles()
}

// 应用名称（影响日志路径和用户数据目录）
app.setName('Flux')

// Windows 任务栏分组与图标归属：与 electron-builder.yml 的 appId 保持一致
app.setAppUserModelId('com.flux.text-editor')

// 单实例锁：第二次启动静默退出，由主实例接收参数、聚焦窗口并打开文件。
const hasSingleInstanceLock = app.requestSingleInstanceLock()
if (!hasSingleInstanceLock) {
  app.quit()
}

// 窗口与任务栏图标：Windows 需 .ico 才能稳定显示；开发模式读项目 resources，
// 打包后图标经 extraResources 放入 process.resourcesPath（.ico 优先，PNG 兜底）。
function resolveWindowIcon(): string | undefined {
  const candidates = [
    join(__dirname, '../../resources/icon.ico'),
    join(process.resourcesPath, 'icon.ico'),
    join(__dirname, '../../resources/icon.png'),
    join(process.resourcesPath, 'icon.png'),
  ]
  for (const icon of candidates) {
    if (existsSync(icon)) return icon
  }
  return undefined
}

// 异常处理器必须在最早阶段注册，确保初始化期异常也能被捕获
setupErrorHandlers()
registerLocalFileProtocol()
enqueueOpenFile(process.argv)

function createWindow(workspaceRoot: string | null): BrowserWindow {
  const theme = store.get('theme') === 'light' ? 'light' : 'dark'
  const backgroundColor = theme === 'light' ? '#f2f2f7' : '#1c1c1e'

  const mainWindow = new BrowserWindow({
    show: false,
    width: 1440,
    height: 900,
    backgroundColor,
    icon: resolveWindowIcon(),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
    },
  })
  windowCoordinator.register(mainWindow, workspaceRoot)
  closeCoordinator.register(mainWindow)

  log.info('Main window created')

  const isExternalHttpUrl = (url: string): boolean => /^https?:\/\//i.test(url)

  // 阻止 renderer 通过 target=_blank 在应用内打开新窗口，统一交给系统浏览器。
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isExternalHttpUrl(url)) {
      void shell.openExternal(url)
    }
    return { action: 'deny' }
  })

  // 阻止主窗口跳转到外部链接，避免覆盖当前应用界面导致“卡死”感知。
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!isExternalHttpUrl(url)) return
    event.preventDefault()
    void shell.openExternal(url)
  })

  mainWindow.webContents.on(
    'did-fail-load',
    (_event, errorCode, errorDescription, _url, isMainFrame) => {
      if (!isMainFrame || mainWindow.isDestroyed()) return
      log.error(`window load failed, code=${errorCode}, reason=${errorDescription}`)
      mainWindow.destroy()
    },
  )

  mainWindow.on('closed', () => {
    log.info('Main window closed')
  })

  mainWindow.once('ready-to-show', () => {
    setImmediate(() => SkillManager.getInstance().init())
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    const rendererUrl = new URL(process.env.ELECTRON_RENDERER_URL)
    rendererUrl.searchParams.set('theme', theme)
    void mainWindow.loadURL(rendererUrl.toString()).catch((error) => {
      log.error(`window load failed, reason=${String(error)}`)
      if (!mainWindow.isDestroyed()) mainWindow.destroy()
    })
  } else {
    void mainWindow
      .loadFile(join(__dirname, '../renderer/index.html'), {
        query: { theme },
      })
      .catch((error) => {
        log.error(`window load failed, reason=${String(error)}`)
        if (!mainWindow.isDestroyed()) mainWindow.destroy()
      })
  }
  return mainWindow
}

app.whenReady().then(() => {
  if (!hasSingleInstanceLock) return

  log.info('App ready')

  // Windows / Linux：去掉系统菜单栏（File / Edit / …），避免与自定义标题区重复叠层。
  // macOS 保留默认菜单（复制粘贴、窗口菜单依赖菜单栏）。
  if (process.platform !== 'darwin') {
    Menu.setApplicationMenu(null)
  }

  registerAllHandlers(windowCoordinator)
  windowCoordinator.registerHandlers()
  closeCoordinator.registerHandlers()
  syncNativeChromeTheme()
  isReady = true
  flushPendingOpenFiles()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      void windowCoordinator.create({ workspaceRoot: null })
    }
  })
})

app.on('second-instance', (_event, commandLine, workingDirectory) => {
  enqueueOpenFile(commandLine, workingDirectory)
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
