import { useCallback, useState } from 'react'
import { useSettingsStore, type Provider } from '../stores/settingsStore'
import { useFileStore } from '../stores/fileStore'
import { ANTHROPIC_MODEL_IDS, OPENAI_OFFICIAL_MODEL_IDS } from '../config/providerModels'
import type { WorkspaceConfigFilePayload } from '../../../shared/types'

interface TestResult {
  success: boolean
  error?: string
}

interface UseProviderReturn {
  providers: Provider[]
  addProvider: (name: string, type: Provider['type'], baseUrl?: string) => Provider
  updateProvider: (id: string, updates: Partial<Provider>) => void
  deleteProvider: (id: string) => void
  testConnection: (provider: Provider) => Promise<TestResult>
  save: () => Promise<void>
  load: () => Promise<void>
  applyWorkspaceSupplierFromConfig: (cfg: WorkspaceConfigFilePayload) => void
  testingId: string | null
  testResults: Record<string, TestResult | null>
}

export function useProvider(): UseProviderReturn {
  const providers = useSettingsStore((s) => s.providers)
  const setProviders = useSettingsStore((s) => s.setProviders)
  const setActiveProvider = useSettingsStore((s) => s.setActiveProvider)
  const setConfigured = useSettingsStore((s) => s.setConfigured)
  const setTheme = useSettingsStore((s) => s.setTheme)
  const [testingId, setTestingId] = useState<string | null>(null)
  const [testResults, setTestResults] = useState<Record<string, TestResult | null>>({})

  /** Generate a simple unique ID */
  const generateId = useCallback(() => `provider-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, [])

  /** Load settings from electron-store and sync to zustand */
  const load = useCallback(async () => {
    try {
      const response = await window.electronAPI.settings.get()
      const resp = response as {
        success?: boolean
        data?: {
          providers?: Provider[]
          activeProvider?: string | null
          theme?: string
          configured?: boolean
        }
      }
      if (resp?.success && resp.data) {
        const rawList = resp.data.providers ?? []
        const activeId = resp.data.activeProvider
        if (rawList.length === 0) {
          setProviders([])
          setActiveProvider(null)
        } else {
          const chosen = rawList.find((p) => p.id === activeId) ?? rawList[0]
          setProviders([chosen])
          setActiveProvider(chosen.id)
        }
        if (resp.data.configured !== undefined) {
          setConfigured(resp.data.configured)
        }
        if (resp.data.theme === 'light' || resp.data.theme === 'dark') {
          setTheme(resp.data.theme)
        }
      }
    } catch (_err) {
      // Store load failed; keep defaults
    }
  }, [setProviders, setActiveProvider, setConfigured, setTheme])

  /** 将工作区 config 中的供应商（默认 Claude）写入唯一一条记录（保留已有 apiKey） */
  const applyWorkspaceSupplierFromConfig = useCallback(
    (cfg: WorkspaceConfigFilePayload) => {
      const s = cfg.supplier
      const state = useSettingsStore.getState()
      const prev = state.providers[0]
      const id = prev?.id ?? generateId()
      setProviders([
        {
          id,
          name: s.name,
          type: s.type,
          apiKey: prev?.apiKey ?? '',
          model: s.model,
          baseUrl: s.type === 'anthropic' ? undefined : s.baseUrl || undefined,
        },
      ])
      setActiveProvider(id)
    },
    [generateId, setProviders, setActiveProvider],
  )

  /** Persist current providers to electron-store via IPC */
  const save = useCallback(async () => {
    const current = useSettingsStore.getState()
    const workspaceRoot = useFileStore.getState().workspaceRoot
    const payload = {
      providers: current.providers.slice(0, 1).map((p) => ({ ...p })),
      activeProvider: current.activeProvider,
      theme: current.theme,
      workspaceRoot,
    }

    const res = (await window.electronAPI.settings.save(payload)) as {
      success?: boolean
      error?: string
    }
    await load()
    if (res && res.success === false) {
      throw new Error(res.error || '保存失败')
    }
  }, [load])

  /** Add a new provider with sensible defaults and add to local store */
  const addProvider = useCallback(
    (name: string, type: Provider['type'], baseUrl?: string): Provider => {
      const presetModels: Record<Provider['type'], string> = {
        anthropic: ANTHROPIC_MODEL_IDS[0] ?? 'claude-opus-4-7',
        anthropic_compat: ANTHROPIC_MODEL_IDS[0] ?? 'claude-opus-4-7',
        openai_compat: OPENAI_OFFICIAL_MODEL_IDS[0] ?? 'gpt-5.5',
      }

      const provider: Provider = {
        id: generateId(),
        name,
        type,
        apiKey: '',
        model: presetModels[type],
      }

      if (type !== 'anthropic' && baseUrl) {
        provider.baseUrl = baseUrl
      } else if (type !== 'anthropic') {
        provider.baseUrl = ''
      }

      setProviders([provider])
      setActiveProvider(provider.id)

      return provider
    },
    [generateId, setProviders],
  )

  /** Update a single provider's fields（必须用 getState，避免 addProvider 同次点击闭包仍是旧列表） */
  const updateProvider = useCallback(
    (id: string, updates: Partial<Provider>) => {
      const list = useSettingsStore.getState().providers
      const next = list.map((p) => (p.id === id ? { ...p, ...updates } : p))
      setProviders(next)
    },
    [setProviders],
  )

  /** Delete a provider from local state; call save() to persist */
  const deleteProvider = useCallback(
    (id: string) => {
      const list = useSettingsStore.getState().providers
      const next = list.filter((p) => p.id !== id)
      setProviders(next)
      const activeId = useSettingsStore.getState().activeProvider
      if (activeId === id) {
        setActiveProvider(next.length > 0 ? next[0].id : null)
      }
    },
    [setProviders, setActiveProvider],
  )

  /** Test connection for a provider via main-process IPC */
  const testConnection = useCallback(
    async (provider: Provider): Promise<TestResult> => {
      if (!provider.apiKey || provider.apiKey.trim() === '') {
        const result: TestResult = { success: false, error: 'API Key 不能为空' }
        setTestResults((prev) => ({ ...prev, [provider.id]: result }))
        return result
      }

      setTestingId(provider.id)
      setTestResults((prev) => ({ ...prev, [provider.id]: null }))

      try {
        const raw = (await window.electronAPI.settings.testConnection({
          id: provider.id,
          name: provider.name,
          type: provider.type,
          apiKey: provider.apiKey,
          baseUrl: provider.baseUrl,
          model: provider.model,
        })) as { success?: boolean; error?: string }
        const result: TestResult =
          raw && typeof raw.success === 'boolean'
            ? { success: raw.success, error: raw.error }
            : { success: false, error: '未收到有效测试结果' }
        setTestResults((prev) => ({ ...prev, [provider.id]: result }))
        return result
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error'
        const result: TestResult = { success: false, error: message }
        setTestResults((prev) => ({ ...prev, [provider.id]: result }))
        return result
      } finally {
        setTestingId(null)
      }
    },
    [],
  )

  return {
    providers,
    addProvider,
    updateProvider,
    deleteProvider,
    testConnection,
    save,
    load,
    applyWorkspaceSupplierFromConfig,
    testingId,
    testResults,
  }
}
