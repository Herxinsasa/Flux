import { existsSync } from 'fs'
import { app, BrowserWindow, Menu, dialog, ipcMain, shell } from 'electron'
import { join } from 'path'
import { registerAllHandlers } from './ipc/index'
import log from './logger'
import { setupErrorHandlers } from './error-handler'
import { registerLocalFileProtocol } from './local-file-protocol'
import { syncNativeChromeTheme } from './native-theme'
import store from './store/index'
import { SkillManager } from './skill/skill-manager'
import { IPC_CHANNELS } from '../shared/ipc-channels'
import { extractOpenFilePath } from '../shared/launch-file'

const pendingOpenFiles: string[] = []

function flushPendingOpenFiles(): void {
  const [mainWindow] = BrowserWindow.getAllWindows()
  if (!mainWindow || mainWindow.webContents.isLoading()) return
  while (pendingOpenFiles.length > 0) {
    mainWindow.webContents.send(IPC_CHANNELS.APP_OPEN_FILE, pendingOpenFiles.shift())
  }
}

function enqueueOpenFile(commandLine: string[]): void {
  const filePath = extractOpenFilePath(commandLine)
  if (!filePath || pendingOpenFiles.includes(filePath)) return
  pendingOpenFiles.push(filePath)
  flushPendingOpenFiles()
}

// 应用名称（影响日志路径和用户数据目录）
app.setName('Flux')

// Windows 任务栏分组与图标归属：与 electron-builder.yml 的 appId 保持一致
app.setAppUserModelId('com.flux.text-editor')

// 单实例锁：第二次启动时提示并退出，避免多开导致用户误以为“卡住”。
const hasSingleInstanceLock = app.requestSingleInstanceLock()
if (!hasSingleInstanceLock) {
  void app.whenReady().then(() => {
    dialog.showMessageBoxSync({
      type: 'info',
      title: 'Flux',
      message: 'Flux 已在运行，不支持多开。',
      detail: '请切换到已打开的 Flux 窗口。',
      buttons: ['确定'],
      defaultId: 0,
    })
    app.quit()
  })
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

function createWindow(): void {
  const theme = store.get('theme') === 'light' ? 'light' : 'dark'
  const backgroundColor = theme === 'light' ? '#f2f2f7' : '#1c1c1e'

  const mainWindow = new BrowserWindow({
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
  let closeApproved = false
  const approveClose = () => {
    closeApproved = true
    mainWindow.close()
  }
  ipcMain.on(IPC_CHANNELS.APP_CLOSE_APPROVED, approveClose)

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

  mainWindow.on('close', (event) => {
    if (closeApproved || mainWindow.webContents.isDestroyed()) return
    event.preventDefault()
    mainWindow.webContents.send(IPC_CHANNELS.APP_CLOSE_REQUEST)
  })

  mainWindow.on('closed', () => {
    ipcMain.removeListener(IPC_CHANNELS.APP_CLOSE_APPROVED, approveClose)
    log.info('Main window closed')
  })

  // 首次启动：did-finish-load 时 React 渲染进程可能尚未 mount 并注册 onOpenFile 监听，
  // 立即 flush 会丢失打开文件事件。延迟 flush 给 React 足够时间完成 mount 与监听注册。
  mainWindow.webContents.once('did-finish-load', () => {
    setTimeout(flushPendingOpenFiles, 300)
  })
  mainWindow.once('ready-to-show', () => {
    setImmediate(() => SkillManager.getInstance().init())
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    const rendererUrl = new URL(process.env.ELECTRON_RENDERER_URL)
    rendererUrl.searchParams.set('theme', theme)
    void mainWindow.loadURL(rendererUrl.toString())
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'), {
      query: { theme },
    })
  }
}

app.whenReady().then(() => {
  if (!hasSingleInstanceLock) return

  log.info('App ready')

  // Windows / Linux：去掉系统菜单栏（File / Edit / …），避免与自定义标题区重复叠层。
  // macOS 保留默认菜单（复制粘贴、窗口菜单依赖菜单栏）。
  if (process.platform !== 'darwin') {
    Menu.setApplicationMenu(null)
  }

  registerAllHandlers()
  syncNativeChromeTheme()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('second-instance', (_event, commandLine) => {
  const [mainWindow] = BrowserWindow.getAllWindows()
  if (mainWindow?.isMinimized()) {
    mainWindow.restore()
  }
  mainWindow?.focus()
  enqueueOpenFile(commandLine)
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
