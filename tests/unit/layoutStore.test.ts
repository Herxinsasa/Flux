import { beforeEach, describe, expect, it } from 'vitest'
import { useLayoutStore } from '../../src/renderer/src/stores/layoutStore'

describe('layout store workspace visibility', () => {
  beforeEach(() => {
    localStorage.clear()
    useLayoutStore.setState({ sidebarVisible: true, minimalMode: false })
  })

  it('restores the workspace in one action when leaving minimal mode', () => {
    useLayoutStore.setState({ sidebarVisible: true, minimalMode: true })
    useLayoutStore.getState().toggleSidebar()
    expect(useLayoutStore.getState()).toMatchObject({ sidebarVisible: true, minimalMode: false })
  })

  it('toggles and persists workspace visibility outside minimal mode', () => {
    useLayoutStore.getState().toggleSidebar()
    expect(useLayoutStore.getState().sidebarVisible).toBe(false)
    expect(JSON.parse(localStorage.getItem('flux-layout-v1') ?? '{}').sidebarVisible).toBe(false)
  })
})
