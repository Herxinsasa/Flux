import { useFileStore } from '../stores/fileStore'

export async function openNewWindow(filePath?: string): Promise<void> {
  const response = await window.electronAPI.window.create({
    workspaceRoot: useFileStore.getState().workspaceRoot,
    ...(filePath ? { filePath } : {}),
  })
  if (!response.success) window.alert(response.error ?? '无法创建窗口')
}
