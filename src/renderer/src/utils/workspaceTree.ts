import type { WorkspaceFileEntry } from '../../../shared/types'

export type WorkspaceFsNode =
  | {
      kind: 'dir'
      name: string
      /** posix 风格路径段，用于展开状态 */
      pathKey: string
      children: WorkspaceFsNode[]
    }
  | {
      kind: 'file'
      name: string
      path: string
      relativePath: string
      extension: string
    }

type ChildList = { children: WorkspaceFsNode[] }

function findOrCreateDir(
  parent: ChildList,
  name: string,
  pathKey: string,
): Extract<WorkspaceFsNode, { kind: 'dir' }> {
  const existing = parent.children.find(
    (c): c is Extract<WorkspaceFsNode, { kind: 'dir' }> => c.kind === 'dir' && c.name === name,
  )
  if (existing) return existing
  const dir: Extract<WorkspaceFsNode, { kind: 'dir' }> = { kind: 'dir', name, pathKey, children: [] }
  parent.children.push(dir)
  return dir
}

function sortNodes(nodes: WorkspaceFsNode[]) {
  nodes.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'dir' ? -1 : 1
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
  })
  for (const n of nodes) {
    if (n.kind === 'dir') sortNodes(n.children)
  }
}

function sortChildren(nodes: WorkspaceFsNode[]) {
  nodes.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'dir' ? -1 : 1
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
  })
}

function insertWorkspaceFile(root: ChildList, file: WorkspaceFileEntry): void {
  const parts = file.relativePath.replace(/\\/g, '/').split('/').filter(Boolean)
  if (parts.length === 0) return

  let parent: ChildList = root
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]
    const isLast = i === parts.length - 1
    const pathKey = parts.slice(0, i + 1).join('/')
    if (!isLast) {
      parent = findOrCreateDir(parent, part, pathKey)
      continue
    }
    if (parent.children.some((node) => node.kind === 'file' && node.path === file.path)) return
    const dot = part.lastIndexOf('.')
    parent.children.push({
      kind: 'file',
      name: part,
      path: file.path,
      relativePath: file.relativePath,
      extension: dot > 0 ? part.slice(dot).toLowerCase() : '',
    })
    sortChildren(parent.children)
  }
}

/** 将工作区文件列表构建为目录树（文件夹在前，按名排序） */
export function buildWorkspaceTree(files: WorkspaceFileEntry[]): WorkspaceFsNode[] {
  const root: ChildList = { children: [] }
  for (const file of files) insertWorkspaceFile(root, file)

  sortNodes(root.children)
  return root.children
}

/** Merge newly scanned entries without reconstructing directories that already exist. */
export function mergeWorkspaceTree(tree: WorkspaceFsNode[], files: WorkspaceFileEntry[]): WorkspaceFsNode[] {
  const root: ChildList = { children: tree }
  for (const file of files) insertWorkspaceFile(root, file)
  return [...root.children]
}

export function collectWorkspaceDirKeys(nodes: WorkspaceFsNode[], out: Set<string>) {
  for (const n of nodes) {
    if (n.kind === 'dir') {
      out.add(n.pathKey)
      collectWorkspaceDirKeys(n.children, out)
    }
  }
}
