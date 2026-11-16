let frozen = false
let active = 0
const waiters = new Set<() => void>()

export function setDocumentOperationsFrozen(value: boolean): void {
  frozen = value
}

export function beginDocumentOperation(): (() => void) | null {
  if (frozen) return null
  active++
  return () => {
    active--
    if (active === 0) {
      for (const resolve of waiters) resolve()
      waiters.clear()
    }
  }
}

export function waitForDocumentOperations(): Promise<void> {
  return active === 0 ? Promise.resolve() : new Promise((resolve) => waiters.add(resolve))
}
