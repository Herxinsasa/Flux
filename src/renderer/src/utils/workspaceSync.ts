let revision = 0

export function getWorkspaceRevision(): number {
  return revision
}

export function reportWorkspaceChanged(workspaceRoot: string | null): void {
  const nextRevision = ++revision
  void window.electronAPI.window
    .workspaceChanged(workspaceRoot, nextRevision)
    .then((response) => {
      if (!response.success) window.alert(response.error ?? '工作区同步失败，请重试')
    })
    .catch(() => window.alert('工作区同步失败，请重试'))
}
