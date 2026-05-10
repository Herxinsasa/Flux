import { create } from 'zustand'

type Theme = 'dark' | 'light'

export interface Provider {
  id: string
  name: string
  type: 'anthropic' | 'anthropic_compat' | 'openai_compat'
  apiKey: string
  baseUrl?: string
  model: string
}

interface SettingsState {
  theme: Theme
  providers: Provider[]
  activeProvider: string | null
  isConfigured: boolean
  setTheme: (theme: Theme) => void
  toggleTheme: () => void
  setProviders: (providers: Provider[]) => void
  setActiveProvider: (id: string | null) => void
  setConfigured: (configured: boolean) => void
}

export const useSettingsStore = create<SettingsState>((set) => ({
  theme: 'dark',
  providers: [],
  activeProvider: null,
  isConfigured: false,
  setTheme: (theme) => set({ theme }),
  toggleTheme: () => set((state) => ({ theme: state.theme === 'dark' ? 'light' : 'dark' })),
  setProviders: (providers) => set({ providers }),
  setActiveProvider: (id) => set({ activeProvider: id }),
  setConfigured: (configured) => set({ isConfigured: configured }),
}))
