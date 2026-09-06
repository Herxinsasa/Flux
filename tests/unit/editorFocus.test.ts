import { afterEach, describe, expect, it, vi } from 'vitest'

import { captureEditableFocus } from '../../src/renderer/src/utils/editorFocus'

describe('captureEditableFocus', () => {
  afterEach(() => {
    document.body.innerHTML = ''
    vi.restoreAllMocks()
  })

  it('restores focus to the editor after a blocking dialog', () => {
    const editor = document.createElement('div')
    editor.setAttribute('contenteditable', 'true')
    editor.tabIndex = 0
    document.body.append(editor)
    editor.focus()
    const focus = vi.spyOn(editor, 'focus')
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      callback(0)
      return 1
    })

    const restore = captureEditableFocus()
    document.body.focus()
    restore()

    expect(focus).toHaveBeenCalledWith({ preventScroll: true })
  })

  it('does not steal focus from a non-editable control', () => {
    const button = document.createElement('button')
    document.body.append(button)
    button.focus()
    const focus = vi.spyOn(button, 'focus')

    captureEditableFocus()()

    expect(focus).not.toHaveBeenCalled()
  })
})
