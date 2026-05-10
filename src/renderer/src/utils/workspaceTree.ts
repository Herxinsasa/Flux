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

/** 将工作区文件列表构建为目录树（文件夹在前，按名排序） */
export function buildWorkspaceTree(files: WorkspaceFileEntry[]): WorkspaceFsNode[] {
  const root: ChildList = { children: [] }

  for (const f of files) {
    const parts = f.relativePath.replace(/\\/g, '/').split('/').filter(Boolean)
    if (parts.length === 0) continue

    let parent: ChildList = root
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]
      const isLast = i === parts.length - 1
      const pathKey = parts.slice(0, i + 1).join('/')

      if (isLast) {
        const dot = part.lastIndexOf('.')
        const ext = dot > 0 ? part.slice(dot).toLowerCase() : ''
        parent.children.push({
          kind: 'file',
          name: part,
          path: f.path,
          relativePath: f.relativePath,
          extension: ext,
        })
      } else {
        const dir = findOrCreateDir(parent, part, pathKey)
        parent = dir
      }
    }
  }

  sortNodes(root.children)
  return root.children
}

export function collectWorkspaceDirKeys(nodes: WorkspaceFsNode[], out: Set<string>) {
  for (const n of nodes) {
    if (n.kind === 'dir') {
      out.add(n.pathKey)
      collectWorkspaceDirKeys(n.children, out)
    }
  }
}
