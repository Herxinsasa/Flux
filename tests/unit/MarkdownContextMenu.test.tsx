import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  clampMenuPosition,
  getSubmenuOffsetY,
  MarkdownContextMenu,
} from '../../src/renderer/src/components/editor/MarkdownContextMenu'

afterEach(cleanup)

describe('MarkdownContextMenu', () => {
  it('keeps the main menu inside the viewport', () => {
    expect(clampMenuPosition(790, 590, 196, 200, 800, 600)).toEqual({ x: 596, y: 392 })
  })

  it('moves submenus away from viewport edges', () => {
    expect(getSubmenuOffsetY({ top: 450, bottom: 650 }, 600)).toBe(-58)
    expect(getSubmenuOffsetY({ top: -10, bottom: 200 }, 600)).toBe(18)
  })

  it('disables selection and AI dependent actions when unavailable', () => {
    render(
      <MarkdownContextMenu
        x={10}
        y={10}
        hasSelection={false}
        readOnly={false}
        aiEnabled={false}
        onClose={vi.fn()}
        onCommand={vi.fn()}
      />,
    )

    expect((screen.getByRole('button', { name: '引用' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: '批注' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: '插入' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('emits an enabled insert command', () => {
    const onCommand = vi.fn()
    render(
      <MarkdownContextMenu
        x={10}
        y={10}
        hasSelection={false}
        readOnly={false}
        aiEnabled={true}
        onClose={vi.fn()}
        onCommand={onCommand}
      />,
    )

    fireEvent.mouseEnter(screen.getByRole('button', { name: '插入' }).parentElement!)
    fireEvent.click(screen.getByRole('menuitem', { name: '分割线' }))
    expect(onCommand).toHaveBeenCalledWith('insert-divider')
  })
})
