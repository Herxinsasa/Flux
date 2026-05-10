import { create } from 'zustand'

const STORAGE_KEY = 'flux-layout-v1'

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n))

function readStored(): { sidebarWidth: number; chatWidth: number } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { sidebarWidth: 240, chatWidth: 400 }
    const j = JSON.parse(raw) as { sidebarWidth?: number; chatWidth?: number }
    return {
      sidebarWidth: clamp(Number(j.sidebarWidth) || 240, 180, 520),
      chatWidth: clamp(Number(j.chatWidth) || 400, 280, 720),
    }
  } catch {
    return { sidebarWidth: 240, chatWidth: 400 }
  }
}

function persist(sidebarWidth: number, chatWidth: number) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ sidebarWidth, chatWidth }))
  } catch {
    /* ignore */
  }
}

interface LayoutState {
  sidebarWidth: number
  chatWidth: number
  setSidebarWidth: (w: number) => void
  setChatWidth: (w: number) => void
}

export const useLayoutStore = create<LayoutState>((set, get) => ({
  ...readStored(),

  setSidebarWidth: (w) => {
    const sidebarWidth = clamp(Math.round(w), 180, 520)
    set({ sidebarWidth })
    persist(sidebarWidth, get().chatWidth)
  },

  setChatWidth: (w) => {
    const chatWidth = clamp(Math.round(w), 280, 720)
    set({ chatWidth })
    persist(get().sidebarWidth, chatWidth)
  },
}))
