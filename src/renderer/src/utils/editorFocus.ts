const EDITABLE_FOCUS_SELECTOR =
  '[contenteditable="true"], textarea:not([disabled]), input:not([disabled])'

/** Restore focus after a blocking browser dialog without stealing it from non-editor controls. */
export function captureEditableFocus(): () => void {
  const activeElement = document.activeElement
  if (!(activeElement instanceof HTMLElement) || !activeElement.matches(EDITABLE_FOCUS_SELECTOR)) {
    return () => undefined
  }

  return () => {
    window.requestAnimationFrame(() => {
      if (activeElement.isConnected) activeElement.focus({ preventScroll: true })
    })
  }
}
