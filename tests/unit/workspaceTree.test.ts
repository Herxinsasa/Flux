import { describe, expect, it } from 'vitest'
import { buildWorkspaceTree } from '../../src/renderer/src/utils/workspaceTree'

describe('workspaceTree', () => {
  it('keeps empty directory entries and treats legacy entries as files', () => {
    const tree = buildWorkspaceTree([
      { path: 'C:\\workspace\\empty', relativePath: 'empty', kind: 'directory' },
      { path: 'C:\\workspace\\docs', relativePath: 'docs', kind: 'directory' },
      { path: 'C:\\workspace\\docs\\readme.md', relativePath: 'docs/readme.md' },
    ])

    expect(tree).toHaveLength(2)
    expect(tree[0]).toMatchObject({ kind: 'dir', name: 'docs' })
    expect(tree[1]).toMatchObject({ kind: 'dir', name: 'empty', children: [] })
    if (tree[0]?.kind === 'dir') {
      expect(tree[0].children[0]).toMatchObject({ kind: 'file', name: 'readme.md' })
    }
  })
})
