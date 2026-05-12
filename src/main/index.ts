import { existsSync } from 'fs'
import { app, BrowserWindow, Menu, dialog, shell } from 'electron'
import { join } from 'path'
import { registerAllHandlers } from './ipc/index'
import log from './logger'
import { setupErrorHandlers } from './error-handler'
import { syncNativeChromeTheme } from './native-theme'
import store from './store/index'

// 应用名称（影响日志路径和用户数据目录）
app.setName('Flux')

// 单实例锁：第二次启动时提示并退出，避免多开导致用户误以为“卡住”。
const hasSingleInstanceLock = app.requestSingleInstanceLock()
if (!hasSingleInstanceLock) {
  dialog.showMessageBoxSync({
    type: 'info',
    title: 'Flux',
    message: 'Flux 已在运行，不支持多开。',
    detail: '请切换到已打开的 Flux 窗口。',
    buttons: ['确定'],
    defaultId: 0,
  })
  app.quit()
}

// 开发/未打包：窗口与任务栏使用白底图标；顶部自定义标题栏另用透明 logo。
function resolveWindowIcon(): string | undefined {
  const png = join(__dirname, '../../resources/icon.png')
  if (existsSync(png)) return png
  return undefined
}

// 异常处理器必须在最早阶段注册，确保初始化期异常也能被捕获
setupErrorHandlers()

function createWindow(): void {
  const theme = store.get('theme')
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

  mainWindow.on('closed', () => {
    log.info('Main window closed')
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
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

app.on('second-instance', () => {
  const [mainWindow] = BrowserWindow.getAllWindows()
  if (!mainWindow) return
  if (mainWindow.isMinimized()) {
    mainWindow.restore()
  }
  mainWindow.focus()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
