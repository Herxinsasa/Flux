import { useState, useCallback, useEffect, useRef } from 'react'
import type { Provider } from '../../stores/settingsStore'

interface ProviderCardProps {
  provider: Provider
  isTesting: boolean
  testResult: { success: boolean; error?: string } | null
  onUpdate: (updates: Partial<Provider>) => void
  onDelete: () => void
  onTest: () => void
}

const TYPE_LABELS: Record<Provider['type'], string> = {
  anthropic: 'Anthropic',
  anthropic_compat: 'Anthropic Compat',
  openai_compat: 'OpenAI Compat',
}

export function ProviderCard({
  provider,
  isTesting,
  testResult,
  onUpdate,
  onDelete,
  onTest,
}: ProviderCardProps) {
  const [showKey, setShowKey] = useState(false)
  const [name, setName] = useState(provider.name)
  const [apiKey, setApiKey] = useState(provider.apiKey)
  const [baseUrl, setBaseUrl] = useState(provider.baseUrl ?? '')
  const [model, setModel] = useState(provider.model)

  // Track whether the user has manually changed the key (vs initial masked value)
  const keyTouchedRef = useRef(false)

  // Sync local state from props when provider changes (e.g., after save+reload)
  // Only sync if the user hasn't manually changed the key
  useEffect(() => {
    setName(provider.name)
    setBaseUrl(provider.baseUrl ?? '')
    setModel(provider.model)
    if (!keyTouchedRef.current) {
      setApiKey(provider.apiKey)
    }
  }, [provider.id, provider.name, provider.apiKey, provider.baseUrl, provider.model])

  const isCompat = provider.type !== 'anthropic'

  const handleNameBlur = useCallback(() => {
    onUpdate({ name })
  }, [name, onUpdate])

  const handleApiKeyChange = useCallback((value: string) => {
    setApiKey(value)
    keyTouchedRef.current = true
  }, [])

  const handleApiKeyBlur = useCallback(() => {
    onUpdate({ apiKey })
  }, [apiKey, onUpdate])

  const handleBaseUrlBlur = useCallback(() => {
    if (isCompat) onUpdate({ baseUrl: baseUrl || undefined })
  }, [baseUrl, isCompat, onUpdate])

  const handleModelBlur = useCallback(() => {
    onUpdate({ model })
  }, [model, onUpdate])

  // Flush all local edits to store before testing connection
  const handleTest = useCallback(() => {
    onUpdate({ name, apiKey, baseUrl: isCompat ? baseUrl : undefined, model })
    onTest()
  }, [name, apiKey, baseUrl, model, isCompat, onUpdate, onTest])

  return (
    <div className="bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-[var(--radius-md)] p-4 space-y-3">
      {/* Header: name + type badge + delete */}
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={handleNameBlur}
          className="flex-1 bg-transparent text-[var(--text-primary)] text-sm font-medium outline-none border-b border-transparent focus:border-[var(--accent)] transition-colors"
          placeholder="Provider Name"
        />
        <span className="text-[10px] px-2 py-0.5 rounded-full bg-[var(--accent)]/20 text-[var(--accent)] font-medium uppercase tracking-wide">
          {TYPE_LABELS[provider.type]}
        </span>
        <button
          onClick={onDelete}
          className="text-[var(--text-tertiary)] hover:text-[var(--error)] transition-colors p-1"
          title="删除提供商"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 6h18" />
            <path d="M8 6V4h8v2" />
            <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
            <path d="M10 11v6" />
            <path d="M14 11v6" />
          </svg>
        </button>
      </div>

      {/* API Key */}
      <div>
        <label className="block text-[11px] text-[var(--text-tertiary)] mb-1">API Key</label>
        <div className="relative flex items-center">
          <input
            type={showKey ? 'text' : 'password'}
            value={apiKey}
            onChange={(e) => handleApiKeyChange(e.target.value)}
            onBlur={handleApiKeyBlur}
            placeholder={provider.apiKey.includes('***') ? provider.apiKey : 'sk-...'}
            className="w-full bg-[var(--bg-panel)] border border-[var(--border-subtle)] rounded-[var(--radius-sm)] px-3 py-1.5 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--accent)] transition-colors pr-8"
          />
          <button
            type="button"
            onClick={() => setShowKey((v) => !v)}
            className="absolute right-2 text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors"
            title={showKey ? '隐藏' : '显示'}
          >
            {showKey ? (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94" />
                <path d="M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19" />
                <path d="M1 1l22 22" />
              </svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
            )}
          </button>
        </div>
      </div>

      {/* Base URL (compat only) */}
      {isCompat && (
        <div>
          <label className="block text-[11px] text-[var(--text-tertiary)] mb-1">Base URL</label>
          <input
            type="text"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            onBlur={handleBaseUrlBlur}
            placeholder="https://api.example.com"
            className="w-full bg-[var(--bg-panel)] border border-[var(--border-subtle)] rounded-[var(--radius-sm)] px-3 py-1.5 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--accent)] transition-colors"
          />
        </div>
      )}

      {/* Model */}
      <div>
        <label className="block text-[11px] text-[var(--text-tertiary)] mb-1">Model</label>
        <input
          type="text"
          value={model}
          onChange={(e) => setModel(e.target.value)}
          onBlur={handleModelBlur}
          placeholder="claude-sonnet-4-20250514"
          className="w-full bg-[var(--bg-panel)] border border-[var(--border-subtle)] rounded-[var(--radius-sm)] px-3 py-1.5 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--accent)] transition-colors"
        />
      </div>

      {/* Test connection + result */}
      <div className="flex items-center gap-2 flex-wrap">
        <button
          onClick={handleTest}
          disabled={isTesting || !apiKey.trim()}
          type="button"
          className="flux-btn-secondary text-xs py-1.5 px-3 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {isTesting ? (
            <>
              <svg className="animate-spin" width="12" height="12" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="32" strokeLinecap="round" />
              </svg>
              测试中...
            </>
          ) : (
            '测试连接'
          )}
        </button>

        {/* Result indicators */}
        {testResult && !isTesting && (
          testResult.success ? (
            <span className="flex items-center gap-1 text-xs text-[var(--success)]">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 6L9 17l-5-5" />
              </svg>
              连接成功
            </span>
          ) : (
            <span className="flex items-center gap-1 text-xs text-[var(--error)]" title={testResult.error}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 6L6 18" />
                <path d="M6 6l12 12" />
              </svg>
              {testResult.error?.slice(0, 60) ?? '连接失败'}
            </span>
          )
        )}
      </div>
    </div>
  )
}
