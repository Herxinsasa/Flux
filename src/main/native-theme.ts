import { nativeTheme } from 'electron'
import store from './store/index'

/** 让 Windows/macOS 原生标题栏、关闭按钮等与 flux 内主题一致（Electron nativeTheme） */
export function syncNativeChromeTheme(): void {
  const t = store.get('theme')
  nativeTheme.themeSource = t === 'light' ? 'light' : 'dark'
}
