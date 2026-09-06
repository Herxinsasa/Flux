export function editorScrollRatio(element: Pick<HTMLElement, 'scrollTop' | 'scrollHeight' | 'clientHeight'>): number {
  const maximum = Math.max(0, element.scrollHeight - element.clientHeight)
  if (maximum === 0) return 0
  return Math.min(1, Math.max(0, element.scrollTop / maximum))
}

export function editorScrollTopForRatio(
  element: Pick<HTMLElement, 'scrollHeight' | 'clientHeight'>,
  ratio: number,
): number {
  const maximum = Math.max(0, element.scrollHeight - element.clientHeight)
  return maximum * Math.min(1, Math.max(0, ratio))
}

export interface EditorScrollPosition {
  scrollTop: number
  scrollRatio: number
}

export function captureConnectedEditorScrollPosition(
  element:
    | Pick<HTMLElement, 'scrollTop' | 'scrollHeight' | 'clientHeight' | 'isConnected'>
    | null,
  previous: EditorScrollPosition | null,
): EditorScrollPosition | null {
  if (!element?.isConnected) return previous
  return {
    scrollTop: element.scrollTop,
    scrollRatio: editorScrollRatio(element),
  }
}
