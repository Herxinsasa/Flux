import { create } from 'zustand'

const STORAGE_KEY = 'flux-layout-v1'

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n))

function readStored(): Pick<LayoutState, 'sidebarWidth' | 'chatWidth' | 'sidebarVisible' | 'chatVisible' | 'minimalMode'> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { sidebarWidth: 240, chatWidth: 400, sidebarVisible: true, chatVisible: false, minimalMode: false }
    const j = JSON.parse(raw) as Partial<LayoutState>
    return {
      sidebarWidth: clamp(Number(j.sidebarWidth) || 240, 180, 520),
      chatWidth: clamp(Number(j.chatWidth) || 400, 280, 720),
      sidebarVisible: j.sidebarVisible !== false,
      chatVisible: j.chatVisible === true,
      minimalMode: j.minimalMode === true,
    }
  } catch {
    return { sidebarWidth: 240, chatWidth: 400, sidebarVisible: true, chatVisible: false, minimalMode: false }
  }
}

function persist(state: Pick<LayoutState, 'sidebarWidth' | 'chatWidth' | 'sidebarVisible' | 'chatVisible' | 'minimalMode'>) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {
    /* ignore */
  }
}

interface LayoutState {
  sidebarWidth: number
  chatWidth: number
  sidebarVisible: boolean
  chatVisible: boolean
  minimalMode: boolean
  setSidebarWidth: (w: number) => void
  setChatWidth: (w: number) => void
  toggleSidebar: () => void
  showChat: () => void
  toggleChat: () => void
  toggleMinimalMode: () => void
}

function snapshot(state: LayoutState): Pick<LayoutState, 'sidebarWidth' | 'chatWidth' | 'sidebarVisible' | 'chatVisible' | 'minimalMode'> {
  const { sidebarWidth, chatWidth, sidebarVisible, chatVisible, minimalMode } = state
  return { sidebarWidth, chatWidth, sidebarVisible, chatVisible, minimalMode }
}

export const useLayoutStore = create<LayoutState>((set, get) => ({
  ...readStored(),

  setSidebarWidth: (w) => {
    const sidebarWidth = clamp(Math.round(w), 180, 520)
    set({ sidebarWidth })
    persist({ ...snapshot(get()), sidebarWidth })
  },

  setChatWidth: (w) => {
    const chatWidth = clamp(Math.round(w), 280, 720)
    set({ chatWidth })
    persist({ ...snapshot(get()), chatWidth })
  },

  toggleSidebar: () => {
    if (get().minimalMode) {
      set({ sidebarVisible: true, minimalMode: false })
      persist({ ...snapshot(get()), sidebarVisible: true, minimalMode: false })
      return
    }
    const sidebarVisible = !get().sidebarVisible
    set({ sidebarVisible, minimalMode: false })
    persist({ ...snapshot(get()), sidebarVisible, minimalMode: false })
  },

  showChat: () => {
    if (get().chatVisible && !get().minimalMode) return
    set({ chatVisible: true, minimalMode: false })
    persist({ ...snapshot(get()), chatVisible: true, minimalMode: false })
  },

  toggleChat: () => {
    const chatVisible = !get().chatVisible
    set({ chatVisible, minimalMode: false })
    persist({ ...snapshot(get()), chatVisible, minimalMode: false })
  },

  toggleMinimalMode: () => {
    const minimalMode = !get().minimalMode
    set({ minimalMode })
    persist({ ...snapshot(get()), minimalMode })
  },
}))
