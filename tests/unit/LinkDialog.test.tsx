import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LinkDialog } from '../../src/renderer/src/components/editor/LinkDialog'

afterEach(cleanup)

describe('LinkDialog', () => {
  it('shows initial href and text', () => {
    render(
      <LinkDialog
        open
        mode="edit"
        initialHref="https://example.com"
        initialText="示例"
        onCancel={vi.fn()}
        onSubmit={vi.fn()}
      />,
    )
    expect(screen.getByRole('dialog', { name: '编辑链接' })).toBeTruthy()
    expect((screen.getByLabelText('链接地址') as HTMLInputElement).value).toBe(
      'https://example.com',
    )
    expect((screen.getByLabelText('显示文本') as HTMLInputElement).value).toBe('示例')
  })

  it('submits trimmed values on confirm', () => {
    const onSubmit = vi.fn()
    render(
      <LinkDialog
        open
        mode="insert"
        initialHref="https://"
        initialText="链接文本"
        onCancel={vi.fn()}
        onSubmit={onSubmit}
      />,
    )
    fireEvent.change(screen.getByLabelText('链接地址'), { target: { value: ' ./a.md ' } })
    fireEvent.change(screen.getByLabelText('显示文本'), { target: { value: ' 文档 ' } })
    fireEvent.click(screen.getByRole('button', { name: '确定' }))
    expect(onSubmit).toHaveBeenCalledWith({ href: './a.md', text: '文档' })
  })

  it('validates missing href and text', () => {
    const onSubmit = vi.fn()
    render(
      <LinkDialog
        open
        mode="insert"
        initialHref=""
        initialText=""
        onCancel={vi.fn()}
        onSubmit={onSubmit}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: '确定' }))
    expect(screen.getByRole('alert').textContent).toBe('请输入链接地址')
    expect(onSubmit).not.toHaveBeenCalled()

    fireEvent.change(screen.getByLabelText('链接地址'), { target: { value: './a.md' } })
    fireEvent.click(screen.getByRole('button', { name: '确定' }))
    expect(screen.getByRole('alert').textContent).toBe('请输入显示文本')
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('submits on Enter and cancels on Escape', () => {
    const onSubmit = vi.fn()
    const onCancel = vi.fn()
    render(
      <LinkDialog
        open
        mode="insert"
        initialHref="./a.md"
        initialText="文档"
        onCancel={onCancel}
        onSubmit={onSubmit}
      />,
    )
    fireEvent.keyDown(screen.getByLabelText('链接地址'), { key: 'Enter' })
    expect(onSubmit).toHaveBeenCalledWith({ href: './a.md', text: '文档' })

    fireEvent.keyDown(screen.getByLabelText('链接地址'), { key: 'Escape' })
    expect(onCancel).toHaveBeenCalled()
  })

  it('does not submit when Enter is pressed on the cancel button', () => {
    const onSubmit = vi.fn()
    render(
      <LinkDialog
        open
        mode="insert"
        initialHref="./a.md"
        initialText="文档"
        onCancel={vi.fn()}
        onSubmit={onSubmit}
      />,
    )
    fireEvent.keyDown(screen.getByRole('button', { name: '取消' }), { key: 'Enter' })
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('shows a submit error from the parent and clears it on input', () => {
    const onClearSubmitError = vi.fn()
    render(
      <LinkDialog
        open
        mode="insert"
        initialHref="./a.md"
        initialText="文档"
        onCancel={vi.fn()}
        onSubmit={vi.fn()}
        submitError="无法在此位置插入链接"
        onClearSubmitError={onClearSubmitError}
      />,
    )
    expect(screen.getByRole('alert').textContent).toBe('无法在此位置插入链接')
    fireEvent.change(screen.getByLabelText('链接地址'), { target: { value: './b.md' } })
    expect(onClearSubmitError).toHaveBeenCalled()
  })
})
