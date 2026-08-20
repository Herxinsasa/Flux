import { useState, useCallback, useEffect, useMemo, useRef } from 'react'
import { useSettingsStore, type Provider } from '../../stores/settingsStore'
import { useSessionContextStore } from '../../stores/sessionContextStore'
import { useProvider } from '../../hooks/useProvider'
import { IPC_CHANNELS } from '../../../../shared/ipc-channels'
import type { ProvidersCatalog } from '../../../../shared/types'
import {
  PROVIDER_PRESETS,
  defaultModelForPresetKey,
  getModelIdsForSettings,
  inferPresetKeyFromProvider,
  mergeCurrentModelOption,
} from '../../config/providerModels'
import { SettingsToast, type SettingsToastState } from './SettingsToast'
import { ChevronDown, ChevronRight, RefreshCw } from 'lucide-react'

/* ═══════════════════════════════════════════════════════════════════ */
/*  SettingsView — pixel-exact Pencil kcjFC replica                     */
/* ═══════════════════════════════════════════════════════════════════ */

interface SettingsViewProps {
  onBack: () => void
}

const EPHEMERAL_TEST_ID = '__connection-test__'

interface ManualSessionCleanupOptions {
  retentionDays: number
  maxBytes: number
  protectedSessionIds: string[]
}

export function buildManualCleanupOptions(
  retentionDays: number,
  maxStorageMb: number,
  activeSessionId: string | null,
): ManualSessionCleanupOptions {
  return {
    retentionDays,
    maxBytes: maxStorageMb * 1024 * 1024,
    protectedSessionIds: activeSessionId ? [activeSessionId] : [],
  }
}

function newProviderId(): string {
  return `provider-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

const CUSTOM_PROTOCOL_OPTIONS: Array<{
  value: Provider['type']
  label: string
  endpointHint: string
}> = [
  {
    value: 'anthropic',
    label: 'Anthropic Native Messages',
    endpointHint: '/v1/messages',
  },
  {
    value: 'openai_compat',
    label: 'OpenAI Chat Completions',
    endpointHint: '/v1/chat/completions',
  },
  {
    value: 'anthropic_compat',
    label: 'Anthropic Messages',
    endpointHint: '/v1/messages',
  },
]

function getProtocolLabel(type: Provider['type']): string {
  if (type === 'anthropic') return 'Anthropic Native Messages'
  if (type === 'anthropic_compat') return 'Anthropic Messages'
  if (type === 'openai_compat') return 'OpenAI Chat Completions'
  return 'Anthropic Messages'
}

export function SettingsView({ onBack }: SettingsViewProps) {
  const providers = useSettingsStore((s) => s.providers)
  const setProviders = useSettingsStore((s) => s.setProviders)
  const setActiveProvider = useSettingsStore((s) => s.setActiveProvider)
  const providerModelOptions = useSettingsStore((s) => s.providerModelOptions)
  const setProviderModelOptions = useSettingsStore((s) => s.setProviderModelOptions)

  const { testConnection, save, load, testingId } = useProvider()

  /** Catalog state */
  const [catalog, setCatalog] = useState<ProvidersCatalog | null>(null)

  /** 仅允许一条供应商；列表恒为 0 或 1 条 */
  const activeProvider = providers[0] ?? null
  const isTesting = testingId !== null

  /* ── Form state ── */
  const [presetKey, setPresetKey] = useState('anthropic')
  const [presetOpen, setPresetOpen] = useState(false)
  const [protocolOpen, setProtocolOpen] = useState(false)
  const [apiKey, setApiKey] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [baseUrl, setBaseUrl] = useState('')
  const [model, setModel] = useState('')
  const [modelOpen, setModelOpen] = useState(false)
  const [remoteModels, setRemoteModels] = useState<string[]>([])
  const [refreshingModels, setRefreshingModels] = useState(false)
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [customProviderType, setCustomProviderType] = useState<Provider['type']>('openai_compat')
  const [, setDirty] = useState(false)
  const [toast, setToast] = useState<SettingsToastState | null>(null)
  const prevSavedIdRef = useRef<string | null | undefined>(undefined)
  const modelRequestRef = useRef(0)

  // Load catalog
  useEffect(() => {
    const loadCatalog = async () => {
      try {
        const response = await (window as any).electron.ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_GET_CATALOG)
        if (response.success && response.data) {
          setCatalog(response.data)
        }
      } catch (err) {
        console.warn('Failed to load catalog:', err)
      }
    }
    void loadCatalog()
  }, [])

  // Load + populate from active provider
  useEffect(() => {
    void load()
  }, [load])

  /** 同步表单：存在已保存的一条供应商时整表替换；切换预设类型且清空列表时用预设默认值 */
  useEffect(() => {
    const sid = activeProvider?.id ?? null
    const becameNoSelection =
      prevSavedIdRef.current !== undefined &&
      prevSavedIdRef.current !== null &&
      sid === null
    prevSavedIdRef.current = sid

    if (activeProvider) {
      const inferredPreset = inferPresetKeyFromProvider(activeProvider)
      setPresetKey(inferredPreset)
      setCustomProviderType(activeProvider.type)
      setApiKey(activeProvider.apiKey)
      setBaseUrl(activeProvider.baseUrl ?? '')
      setModel(activeProvider.model)
      setDirty(false)
      return
    }

    const p = PROVIDER_PRESETS[presetKey]
    if (becameNoSelection) {
      setApiKey('')
    }
    setBaseUrl(p.baseUrl ?? '')
    setModel(defaultModelForPresetKey(presetKey))
    setDirty(false)
  }, [activeProvider, presetKey])

  const handlePresetSelect = useCallback(
    (k: string) => {
      setPresetOpen(false)
      setProtocolOpen(false)
      setProviders([])
      setActiveProvider(null)
      setPresetKey(k)
      modelRequestRef.current += 1
      setRefreshingModels(false)
      setRemoteModels([])
      const p = PROVIDER_PRESETS[k]
      setCustomProviderType(p.type)
      setBaseUrl(p.baseUrl ?? '')
      setModel(defaultModelForPresetKey(k))
      setDirty(true)
    },
    [setProviders, setActiveProvider],
  )

  const currentPreset = PROVIDER_PRESETS[presetKey]
  const showProtocolSelector = true
  const selectedProviderType: Provider['type'] = customProviderType
  const selectedProviderName =
    presetKey === 'custom' ? getProtocolLabel(selectedProviderType) : currentPreset.label
  const showBaseUrl = selectedProviderType !== 'anthropic'
  const persistedModels = providerModelOptions[presetKey] ?? []

  const modelOptions = useMemo(() => {
    if (remoteModels.length > 0) return mergeCurrentModelOption(model, remoteModels)
    if (persistedModels.length > 0) return mergeCurrentModelOption(model, persistedModels)
    // 如果有 catalog，优先使用 catalog 中的模型
    if (catalog && ['anthropic', 'openai', 'deepseek', 'kimi', 'glm', 'qwen'].includes(presetKey)) {
      const provider = catalog.providers.find((p) => p.id === presetKey)
      if (provider) {
        const catalogModels = provider.models
          .filter((m) => m.status === 'active')
            .map((m) => m.id)
        return mergeCurrentModelOption(model, catalogModels)
      }
    }
    // 回退到原有的 providerModels 逻辑
    const modelScopedProvider: Provider | null =
      presetKey === 'custom'
        ? {
            id: activeProvider?.id ?? '__custom__',
            name: activeProvider?.name ?? '自定义',
            type: selectedProviderType,
            apiKey: activeProvider?.apiKey ?? '',
            baseUrl: baseUrl || activeProvider?.baseUrl,
            model: model || activeProvider?.model || '',
          }
        : activeProvider

    return mergeCurrentModelOption(
      model,
      getModelIdsForSettings({
        presetKey,
        activeProvider: modelScopedProvider,
        formBaseUrl: baseUrl,
      }),
    )
  }, [model, presetKey, activeProvider, baseUrl, catalog, selectedProviderType, remoteModels, persistedModels])

  /* ── Actions ── */
  const handleTest = useCallback(async () => {
    try {
      if (!apiKey.trim()) {
        setToast({ variant: 'error', message: '请先填写 API Key' })
        return
      }
      const providerForTest = {
        id: activeProvider?.id ?? EPHEMERAL_TEST_ID,
        name: selectedProviderName,
        type: selectedProviderType,
        apiKey: apiKey.trim(),
        model,
        baseUrl:
          selectedProviderType === 'anthropic'
            ? undefined
            : baseUrl.trim() || currentPreset.baseUrl || undefined,
      }
      const r = await testConnection(providerForTest)
      if (r.success) {
        setToast({ variant: 'success', message: '连接成功' })
      } else {
        setToast({ variant: 'error', message: '连接失败，请检查配置' })
      }
    } catch (e) {
      setToast({ variant: 'error', message: '连接失败，请检查配置' })
    }
  }, [activeProvider, apiKey, baseUrl, model, testConnection, currentPreset, selectedProviderName, selectedProviderType])

  const handleSave = useCallback(async () => {
    try {
      const trimmedApiKey = apiKey.trim()
      const trimmedModel = model.trim()
      const effectiveBaseUrl =
        selectedProviderType === 'anthropic'
          ? undefined
          : (baseUrl.trim() || currentPreset.baseUrl || '').trim()

      if (!trimmedApiKey) {
        setToast({ variant: 'error', message: '请先填写 API Key' })
        return
      }
      if (!trimmedModel) {
        setToast({ variant: 'error', message: '请先填写模型' })
        return
      }
      if (selectedProviderType === 'anthropic_compat' && !effectiveBaseUrl) {
        setToast({ variant: 'error', message: 'Anthropic 兼容协议请先填写请求地址' })
        return
      }

      const id = activeProvider?.id ?? newProviderId()
      const next = {
        id,
        name: selectedProviderName,
        type: selectedProviderType,
        apiKey: trimmedApiKey,
        model: trimmedModel,
        baseUrl: selectedProviderType === 'anthropic' ? undefined : effectiveBaseUrl || undefined,
      }
      if (presetKey !== 'custom') {
        setProviderModelOptions({
          ...useSettingsStore.getState().providerModelOptions,
          [presetKey]: remoteModels.length > 0 ? remoteModels : modelOptions,
        })
      }
      setProviders([next])
      setActiveProvider(id)
      setDirty(false)
      await save()
      setToast({ variant: 'success', message: '配置已保存' })
    } catch (e) {
      setToast({
        variant: 'error',
        message: e instanceof Error ? e.message : '保存失败',
      })
    }
  }, [
    activeProvider,
    apiKey,
    baseUrl,
    model,
    save,
    currentPreset,
    presetKey,
    selectedProviderName,
    selectedProviderType,
    setProviders,
    setActiveProvider,
    setProviderModelOptions,
    remoteModels,
    modelOptions,
  ])

  const displayModel =
    model || activeProvider?.model || currentPreset.defaultModel || defaultModelForPresetKey('anthropic')

  const refreshModels = useCallback(async () => {
    if (presetKey === 'custom') {
      setToast({ variant: 'error', message: '自定义供应商暂不支持在线获取模型列表' })
      return
    }
    if (!apiKey.trim()) {
      setToast({ variant: 'error', message: '请先填写 API Key' })
      return
    }
    setRefreshingModels(true)
    const requestId = modelRequestRef.current + 1
    modelRequestRef.current = requestId
    try {
      const response = await window.electronAPI.settings.listModels({
        presetKey: presetKey as 'anthropic' | 'openai' | 'deepseek' | 'kimi' | 'glm' | 'qwen',
        apiKey: apiKey.trim(),
      })
      if (!response.success || !response.data) {
        if (modelRequestRef.current !== requestId) return
        setToast({ variant: 'error', message: response.error ?? '获取模型列表失败' })
        return
      }
      if (modelRequestRef.current !== requestId) return
      setRemoteModels(response.data.models)
      setModelOpen(true)
      setToast({ variant: 'success', message: `已获取 ${response.data.models.length} 个模型` })
    } catch {
      if (modelRequestRef.current !== requestId) return
      setToast({ variant: 'error', message: '获取模型列表失败' })
    } finally {
      if (modelRequestRef.current === requestId) setRefreshingModels(false)
    }
  }, [apiKey, presetKey])

  const clearCurrentConversation = useCallback(() => {
    useSessionContextStore.getState().resetConversationContext()
    setToast({ variant: 'success', message: '当前 AI 对话已清空' })
  }, [])

  return (
    <>
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        background: 'var(--bg-primary)',
      }}
    >
      <header
        className="flex items-center gap-3 shrink-0 border-b border-[var(--border-subtle)]"
        style={{ padding: '20px 24px' }}
      >
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-1 rounded-[var(--radius-sm)] bg-[var(--bg-card)] text-[var(--text-secondary)] border border-[var(--border-subtle)] hover:text-[var(--text-primary)] hover:bg-[var(--hover)] hover:border-[var(--border-visible)] transition-colors"
          style={{ padding: '8px 14px', fontSize: 14, fontFamily: 'var(--font-ui)', cursor: 'pointer' }}
        >
          返回
        </button>
        <h1
          style={{
            fontSize: 17,
            fontWeight: 600,
            fontFamily: 'var(--font-ui)',
            color: 'var(--text-primary)',
            margin: 0,
            flex: 1,
            minWidth: 0,
          }}
        >
          设置
        </h1>
      </header>

      <div className="flux-scroll flux-settings-surface" style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
        <div
          style={{
            margin: '0 auto',
            maxWidth: 560,
            width: '100%',
            boxSizing: 'border-box',
            padding: '32px 24px 48px',
          }}
        >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>

          {/* ── 1. AI 提供商（预设类型） ── */}
          <div>
            <div style={{ fontSize: 14, fontWeight: 600, fontFamily: 'var(--font-ui)', color: 'var(--text-primary)', marginBottom: 8 }}>
              供应商
            </div>
            <div style={{ position: 'relative' }}>
              <button
                type="button"
                onClick={() => setPresetOpen(!presetOpen)}
                className="flux-dropdown-trigger"
              >
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 14, fontWeight: 400, color: 'var(--text-primary)' }}>
                  {currentPreset.label}
                </span>
                <ChevronDown size={16} aria-hidden />
              </button>
              {presetOpen && (
                <>
                  <div style={{ position: 'fixed', inset: 0, zIndex: 49 }} onClick={() => setPresetOpen(false)} />
                  <div className="context-menu flux-scroll" style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 50, marginTop: 4, maxHeight: 280, overflowY: 'auto' }}>
                    {Object.entries(PROVIDER_PRESETS).map(([k, v]) => (
                      <div key={k} className="context-menu-item" onClick={() => handlePresetSelect(k)}
                        style={{ fontWeight: k === presetKey ? 600 : 400 }}>
                        {v.label}
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>

          {showProtocolSelector && (
            <div>
              <div style={{ fontSize: 14, fontWeight: 600, fontFamily: 'var(--font-ui)', color: 'var(--text-primary)', marginBottom: 8 }}>
                协议类型
              </div>
              <div style={{ position: 'relative' }}>
                <button
                  type="button"
                  onClick={() => setProtocolOpen(!protocolOpen)}
                  className="flux-dropdown-trigger"
                >
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 14, fontWeight: 400, color: 'var(--text-primary)' }}>
                    {getProtocolLabel(customProviderType)}
                  </span>
                  <ChevronDown size={16} aria-hidden />
                </button>

                {protocolOpen && (
                  <>
                    <div style={{ position: 'fixed', inset: 0, zIndex: 49 }} onClick={() => setProtocolOpen(false)} />
                    <div className="context-menu flux-scroll" style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 50, marginTop: 4, maxHeight: 240, overflowY: 'auto' }}>
                      {CUSTOM_PROTOCOL_OPTIONS.map((opt) => (
                        <div
                          key={opt.value}
                          className="context-menu-item"
                          onClick={() => {
                            setCustomProviderType(opt.value)
                            setProtocolOpen(false)
                            setDirty(true)
                          }}
                          style={{
                            fontWeight: customProviderType === opt.value ? 600 : 400,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            gap: 10,
                          }}
                        >
                          <span>{opt.label}</span>
                          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-tertiary)' }}>
                            {opt.endpointHint}
                          </span>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>
            </div>
          )}

          {/* ── 2. API Key（可编辑） ── */}
          <div>
            <div style={{ fontSize: 14, fontWeight: 600, fontFamily: 'var(--font-ui)', color: 'var(--text-primary)', marginBottom: 8 }}>
              API Key
            </div>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '12px 14px',
                borderRadius: 8,
                background: 'var(--bg-card)',
                border: '1px solid var(--settings-stroke, var(--border-subtle))',
              }}
            >
              <input
                type={showKey ? 'text' : 'password'}
                value={apiKey}
                onChange={(e) => {
                  setApiKey(e.target.value)
                  setDirty(true)
                }}
                placeholder="粘贴或输入 API Key（已保存的密钥可在此覆盖）"
                autoComplete="off"
                spellCheck={false}
                style={{
                  flex: 1,
                  minWidth: 0,
                  background: 'transparent',
                  border: 'none',
                  outline: 'none',
                  fontFamily: 'var(--font-mono)',
                  fontSize: 14,
                  fontWeight: 400,
                  color: 'var(--text-primary)',
                }}
              />
              <button
                type="button"
                onClick={() => setShowKey(!showKey)}
                title={showKey ? '隐藏密钥' : '显示密钥'}
                className="flex shrink-0 items-center justify-center rounded-[var(--radius-sm)] p-1.5 text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--hover)] transition-colors"
                style={{ background: 'transparent', border: 'none', cursor: 'pointer' }}
              >
                {showKey ? (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94" />
                    <path d="M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19" />
                    <path d="M1 1l22 22" />
                  </svg>
                ) : (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                )}
              </button>
            </div>
          </div>

          {/* ── 3. Base URL（设计稿始终可见；非兼容类预设只读展示官方地址） ── */}
          <div>
            <div style={{ fontSize: 14, fontWeight: 600, fontFamily: 'var(--font-ui)', color: 'var(--text-primary)', marginBottom: 8 }}>
              请求地址
            </div>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                padding: '12px 14px',
                borderRadius: 8,
                background: 'var(--bg-card)',
                border: '1px solid var(--settings-stroke, var(--border-subtle))',
              }}
            >
              {showBaseUrl ? (
                <input
                  value={baseUrl}
                  onChange={(e) => {
                    setBaseUrl(e.target.value)
                    setDirty(true)
                  }}
                  placeholder={currentPreset.baseUrl || 'https://'}
                  style={{
                    width: '100%',
                    minWidth: 0,
                    background: 'transparent',
                    border: 'none',
                    outline: 'none',
                    fontFamily: 'var(--font-mono)',
                    fontSize: 14,
                    color: 'var(--text-secondary)',
                  }}
                />
              ) : (
                <span
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: 14,
                    fontWeight: 400,
                    color: 'var(--text-secondary)',
                  }}
                >
                  https://api.anthropic.com
                </span>
              )}
            </div>
          </div>

          {/* ── 4. 默认模型 ── */}
          <div>
            <div className="flux-settings-label-row">
              <span>默认模型</span>
              <button type="button" className="flux-settings-icon-btn" title="获取模型列表" disabled={refreshingModels || presetKey === 'custom'} onClick={() => void refreshModels()}>
                <RefreshCw size={16} className={refreshingModels ? 'spin' : undefined} aria-hidden />
              </button>
            </div>
            <div style={{ position: 'relative' }}>
              <button
                type="button"
                onClick={() => setModelOpen(!modelOpen)}
                className="flux-dropdown-trigger"
              >
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 14, fontWeight: 400, color: 'var(--text-primary)' }}>
                  {displayModel}
                </span>
                <ChevronDown size={16} aria-hidden />
              </button>
              {modelOpen && (
                <>
                  <div style={{ position: 'fixed', inset: 0, zIndex: 49 }} onClick={() => setModelOpen(false)} />
                  <div
                    className="context-menu flux-scroll"
                    style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 50, marginTop: 4, maxHeight: 240, overflowY: 'auto' }}
                  >
                    {modelOptions.map((m) => (
                      <div
                        key={m}
                        className="context-menu-item"
                        onClick={() => {
                          setModel(m)
                          setModelOpen(false)
                          setDirty(true)
                        }}
                        style={{ fontWeight: m === model ? 600 : 400, fontFamily: 'var(--font-mono)', fontSize: 13 }}
                      >
                        {m}
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>

          {/* ── 5. 测试 + 保存：同一样式层级，悬浮与侧栏文件一致 ── */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={handleTest}
              disabled={isTesting}
              className="flux-btn-secondary"
            >
              {isTesting ? '测试中...' : '测试连接'}
            </button>
            {/* Test status: padding [10,14], gap 4 */}
            <button type="button" onClick={handleSave} className="flux-btn-secondary">
              保存配置
            </button>
          </div>

          <section className="flux-settings-advanced">
            <button type="button" className="flux-settings-advanced-trigger" aria-expanded={advancedOpen} onClick={() => setAdvancedOpen((value) => !value)}>
              {advancedOpen ? <ChevronDown size={17} /> : <ChevronRight size={17} />}<span>高级设置</span>
            </button>
            {advancedOpen && <div className="flux-settings-advanced-body">
              <h2>AI 助手</h2>
              <div className="flux-settings-data-row"><span>本次对话</span><button type="button" onClick={clearCurrentConversation} className="flux-btn-secondary">清空当前对话</button></div>
              <p className="flux-settings-save-note">Flux 默认只保留本次运行内的 AI 对话，重启后不恢复历史。</p>
              <h2>系统集成</h2>
              <div className="flux-settings-data-row">
                <span>Markdown/文本/日志默认打开方式</span>
                <button type="button" className="flux-btn-secondary" onClick={() => void window.electronAPI.shell.openExternal('ms-settings:defaultapps')}>设为默认应用</button>
              </div>
              <p className="flux-settings-save-note">点击后打开 Windows 默认应用设置，选择 Flux 作为对应文件类型的默认打开方式；双击文档时 Flux 会自动加载所在文件夹并打开文档。</p>
            </div>}
          </section>

        </div>
        </div>
      </div>
    </div>
    <SettingsToast toast={toast} onDismiss={() => setToast(null)} />
    </>
  )
}
