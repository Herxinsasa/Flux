import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WorkspaceTreePanel } from '../../src/renderer/src/components/common/WorkspaceTreePanel'

const { openNewWindow } = vi.hoisted(() => ({ openNewWindow: vi.fn() }))
vi.mock('../../src/renderer/src/utils/windowActions', () => ({ openNewWindow }))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('workspace tree panel', () => {
  it('preserves nested expansion and ordinary opening, and opens the context selection in a new window', () => {
    const onOpenFile = vi.fn()
    render(
      <WorkspaceTreePanel
        workspaceRoot="/notes"
        workspaceFiles={[{ path: '/notes/folder/a.md', relativePath: 'folder/a.md' }]}
        scanVersion={1}
        scanStatus="complete"
        scanError={null}
        currentFile={null}
        onOpenFile={onOpenFile}
      />,
    )
    fireEvent.click(screen.getByText('folder'))
    fireEvent.click(screen.getByText('a.md'))
    expect(onOpenFile).toHaveBeenCalledWith('/notes/folder/a.md')
    fireEvent.contextMenu(screen.getByText('a.md'), { clientX: 10, clientY: 20 })
    fireEvent.click(screen.getByText('在新窗口打开'))
    expect(openNewWindow).toHaveBeenCalledWith('/notes/folder/a.md')
  })
})
