import { cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FileImporter } from '../../src/renderer/src/components/FileImporter'

describe('FileImporter', () => {
  const getFilePath = vi.fn()

  beforeEach(() => {
    getFilePath.mockReset()
    Object.defineProperty(window, 'electronAPI', {
      configurable: true,
      value: { file: { getFilePath } },
    })
  })

  afterEach(() => cleanup())

  it('does not reopen a drop already handled by an editor', () => {
    const onFilesDrop = vi.fn()
    render(<FileImporter onFilesDrop={onFilesDrop}>content</FileImporter>)
    const event = new Event('drop', { bubbles: true, cancelable: true }) as DragEvent
    event.preventDefault()

    window.dispatchEvent(event)

    expect(onFilesDrop).not.toHaveBeenCalled()
    expect(getFilePath).not.toHaveBeenCalled()
  })
})
