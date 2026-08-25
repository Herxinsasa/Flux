import { app, ipcMain } from 'electron'
import { IPC_CHANNELS } from '../../shared/ipc-channels'
import { parseProviderModelPage } from '../../shared/provider-model-list'
import {
  normalizeAnthropicBaseUrl,
  providerChatEndpoint,
  providerModelsEndpoint,
} from '../../shared/provider-endpoints'
import store from '../store/index'
import { normalizeReadingPreferences, type ReadingPreferences } from '../store/schema'
import log from '../logger'
import { syncNativeChromeTheme } from '../native-theme'
import { loadCatalog, isModelValid } from '../services/catalog-service'

interface ProviderConfig {
  id: string
  name: string
  type: 'anthropic' | 'anthropic_compat' | 'openai_compat'
  apiKey: string
  baseUrl?: string
  model: string
  keepExistingKey?: boolean // renderer hint: preserve the already-stored key
}

interface SettingsPayload {
  theme?: 'dark' | 'light'
  providers?: ProviderConfig[]
  activeProvider?: string | null
  configured?: boolean
  onboardingCompleted?: boolean
  readingPreferences?: Partial<ReadingPreferences>
  providerModelOptions?: Record<string, string[]>
  sessionPersistenceEnabled?: boolean
  sessionRetentionDays?: number
  sessionMaxStorageMb?: number
}

type TestConnectionPayload = ProviderConfig
type ModelProviderKey = 'anthropic' | 'openai' | 'deepseek' | 'kimi' | 'glm' | 'qwen' | 'custom'

interface ListModelsPayload {
  presetKey: ModelProviderKey
  apiKey: string
  type: ProviderConfig['type']
  baseUrl?: string
}

const MODEL_PROVIDER_BASE_URLS: Partial<Record<ModelProviderKey, string>> = {
  anthropic: 'https://api.anthropic.com',
  openai: 'https://api.openai.com',
  deepseek: 'https://api.deepseek.com',
  kimi: 'https://api.moonshot.cn',
  glm: 'https://open.bigmodel.cn/api/paas/v4',
  qwen: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
}

function anthropicMessagesEndpoint(baseUrl?: string): string {
  return providerChatEndpoint('anthropic', baseUrl)
}

function normalizeProviderModelOptions(value: unknown): Record<string, string[]> {
  if (!value || typeof value !== 'object') return {}
  const output: Record<string, string[]> = {}
  for (const [key, models] of Object.entries(value as Record<string, unknown>)) {
    if (!/^[a-z0-9_-]{1,40}$/i.test(key) || !Array.isArray(models)) continue
    const unique = [...new Set(models
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.trim())
      .filter(Boolean)
      .slice(0, 1000))]
    if (unique.length > 0) output[key] = unique
  }
  return output
}

/** 历史 UI 脱敏 / 误写入会产生含 `***` 的短占位串，不得持久化也不得直接拿去请求 API */
function looksLikeMaskedPlaceholder(key: string): boolean {
  return typeof key === 'string' && key.includes('***')
}

/** 保存时：若表单仍是占位串，则沿用仓库里同 id 的完整密钥，避免把 sk-ant…***… 写回磁盘 */
function resolveApiKeyForPersist(
  incoming: string,
  id: string,
  existingMap: Map<string, ProviderConfig>,
): string {
  const trimmed = typeof incoming === 'string' ? incoming.trim() : ''
  if (!looksLikeMaskedPlaceholder(trimmed)) {
    return trimmed
  }
  const existing = existingMap.get(id)
  if (existing?.apiKey) {
    if (!looksLikeMaskedPlaceholder(existing.apiKey)) {
      return existing.apiKey
    }
    return existing.apiKey
  }
  return ''
}

/** 测通时：表单若为占位串，从本地 store 取明文密钥（支持临时测试 id、单供应商回退） */
function resolveApiKeyForTest(payload: ProviderConfig): string {
  let apiKey = payload.apiKey ?? ''
  if (!looksLikeMaskedPlaceholder(apiKey)) {
    return apiKey.trim()
  }
  const providers = (store.get('providers') || []) as ProviderConfig[]
  let stored = providers.find((x) => x.id === payload.id)
  if (!stored && providers.length === 1) {
    stored = providers[0]
  }
  if (stored?.apiKey && !looksLikeMaskedPlaceholder(stored.apiKey)) {
    return stored.apiKey.trim()
  }
  return apiKey.trim()
}

/**
 * Minimal Anthropic Messages API request to verify connectivity.
 * Sends a single-user message and expects a valid response.
 */
async function testAnthropicConnection(config: ProviderConfig): Promise<{ success: boolean; error?: string }> {
  const baseUrl = normalizeAnthropicBaseUrl(config.baseUrl)
  const endpoint = anthropicMessagesEndpoint(baseUrl)
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 15000)

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'x-api-key': config.apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: config.model,
        max_tokens: 1,
        messages: [{ role: 'user', content: 'hi' }],
      }),
      signal: controller.signal,
    })

    if (response.status === 401) {
      return { success: false, error: 'API Key 无效 (401 Unauthorized)' }
    }
    if (response.status === 403) {
      return { success: false, error: '权限不足 (403 Forbidden)' }
    }
    if (!response.ok) {
      const text = await response.text().catch(() => '')
      log.error('Anthropic connectivity test failed', {
        providerId: config.id,
        providerName: config.name,
        model: config.model,
        baseUrl,
        endpoint,
        status: response.status,
        body: text,
      })
      return { success: false, error: `服务器返回错误 ${response.status}: ${text.slice(0, 200)}` }
    }

    return { success: true }
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      log.error('Anthropic connectivity test timeout', {
        providerId: config.id,
        providerName: config.name,
        model: config.model,
        baseUrl,
        endpoint,
      })
      return { success: false, error: '连接超时 (15s) — 请检查请求地址是否正确' }
    }
    const message = err instanceof Error ? err.message : 'Unknown error'
    log.error('Anthropic connectivity test network error', err)
    return { success: false, error: `网络错误: ${message}` }
  } finally {
    clearTimeout(timeout)
  }
}

/**
 * Test OpenAI-compatible Chat Completions endpoint.
 * Sends a minimal message to verify the API key.
 */
async function testOpenAICompatConnection(config: ProviderConfig): Promise<{ success: boolean; error?: string }> {
  const baseUrl = config.baseUrl || 'https://api.openai.com'
  const endpoint = providerChatEndpoint('openai_compat', baseUrl)
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 15000)

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: config.model,
        max_tokens: 1,
        messages: [{ role: 'user', content: 'hi' }],
      }),
      signal: controller.signal,
    })

    if (response.status === 401) {
      return { success: false, error: 'API Key 无效 (401 Unauthorized)' }
    }
    if (response.status === 403) {
      return { success: false, error: '权限不足 (403 Forbidden)' }
    }
    if (!response.ok) {
      const text = await response.text().catch(() => '')
      log.error('OpenAI-compatible connectivity test failed', {
        providerId: config.id,
        providerName: config.name,
        model: config.model,
        baseUrl,
        endpoint,
        status: response.status,
        body: text,
      })
      return { success: false, error: `服务器返回错误 ${response.status}: ${text.slice(0, 200)}` }
    }

    return { success: true }
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      log.error('OpenAI-compatible connectivity test timeout', {
        providerId: config.id,
        providerName: config.name,
        model: config.model,
        baseUrl,
        endpoint,
      })
      return { success: false, error: '连接超时 (15s) — 请检查请求地址是否正确' }
    }
    const message = err instanceof Error ? err.message : 'Unknown error'
    log.error('OpenAI-compatible connectivity test network error', err)
    return { success: false, error: `网络错误: ${message}` }
  } finally {
    clearTimeout(timeout)
  }
}

async function runProviderConnectivityTest(
  config: ProviderConfig,
): Promise<{ success: boolean; error?: string }> {
  switch (config.type) {
    case 'anthropic':
      return await testAnthropicConnection(config)
    case 'anthropic_compat':
      if (!config.baseUrl || config.baseUrl.trim() === '') {
        return { success: false, error: '请先设置请求地址' }
      }
      return await testAnthropicConnection(config)
    case 'openai_compat':
      return await testOpenAICompatConnection(config)
    default:
      return { success: false, error: `不支持的提供商类型: ${(config as ProviderConfig).type}` }
  }
}

async function readResponseTextLimited(response: Response, maxBytes: number): Promise<string> {
  if (!response.body) {
    const buffer = new Uint8Array(await response.arrayBuffer())
    if (buffer.byteLength > maxBytes) throw new Error('模型列表响应过大')
    return new TextDecoder().decode(buffer)
  }
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let bytes = 0
  let text = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    bytes += value.byteLength
    if (bytes > maxBytes) {
      await reader.cancel().catch(() => undefined)
      throw new Error('模型列表响应过大')
    }
    text += decoder.decode(value, { stream: true })
  }
  return text + decoder.decode()
}

async function listProviderModels(payload: ListModelsPayload): Promise<{ success: boolean; data?: { models: string[] }; error?: string }> {
  const baseUrl = payload.baseUrl?.trim() || MODEL_PROVIDER_BASE_URLS[payload.presetKey]
  if (!baseUrl) return { success: false, error: '请先填写请求地址' }
  const apiKey = payload.apiKey.trim()
  if (!apiKey || looksLikeMaskedPlaceholder(apiKey)) return { success: false, error: '请先填写完整 API Key' }
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 15000)
  try {
    const usesAnthropicProtocol = payload.type === 'anthropic' || payload.type === 'anthropic_compat'
    const headers = usesAnthropicProtocol
      ? { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' }
      : { Authorization: `Bearer ${apiKey}` }
    const modelIds = new Set<string>()
    const url = new URL(providerModelsEndpoint(payload.type, baseUrl))
    for (let pageIndex = 0; pageIndex < 20; pageIndex += 1) {
      const response = await fetch(url, { headers, signal: controller.signal })
      if (response.status === 401) return { success: false, error: 'API Key 无效 (401 Unauthorized)' }
      if (response.status === 403) return { success: false, error: '权限不足 (403 Forbidden)' }
      if (!response.ok) return { success: false, error: `获取模型列表失败 (${response.status})` }
      const contentLength = Number(response.headers.get('content-length') || 0)
      if (contentLength > 1024 * 1024) return { success: false, error: '模型列表响应过大' }
      const page = parseProviderModelPage(JSON.parse(await readResponseTextLimited(response, 1024 * 1024)) as unknown)
      page.models.forEach((id) => modelIds.add(id))
      if (!page.hasMore || !page.lastId || modelIds.size >= 10_000) break
      url.searchParams.set(usesAnthropicProtocol ? 'after_id' : 'after', page.lastId)
    }
    const models = [...modelIds].sort((left, right) => left.localeCompare(right))
    return models.length > 0 ? { success: true, data: { models } } : { success: false, error: '供应商未返回可用模型' }
  } catch (error) {
    if ((error as Error).name === 'AbortError') return { success: false, error: '获取模型列表超时 (15s)' }
    log.error('List provider models failed', { presetKey: payload.presetKey, type: payload.type, baseUrl, error })
    return { success: false, error: '获取模型列表失败，请检查网络' }
  } finally {
    clearTimeout(timeout)
  }
}

export function registerSettingsHandlers(): void {
  const { APP_GET_VERSION, SETTINGS_SAVE, SETTINGS_GET, SETTINGS_GET_CATALOG, SETTINGS_TEST_CONNECTION, SETTINGS_LIST_MODELS } = IPC_CHANNELS

  ipcMain.handle(APP_GET_VERSION, async () => {
    try {
      return { success: true, data: { version: app.getVersion() } }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      log.error(`APP_GET_VERSION failed: ${message}`)
      return { success: false, error: message }
    }
  })

  // --- GET: 本地明文配置；供应商 apiKey 原样返回供表单展示（与磁盘一致） ---
  ipcMain.handle(SETTINGS_GET, async () => {
    try {
      const raw = store.store
      const providers = [...(raw.providers || [])] as ProviderConfig[]

      return {
        success: true,
        data: {
          theme: raw.theme,
          providers,
          activeProvider: raw.activeProvider,
          configured: raw.configured ?? false,
          onboardingCompleted: raw.onboardingCompleted ?? false,
          readingPreferences: normalizeReadingPreferences(raw.readingPreferences),
          providerModelOptions: normalizeProviderModelOptions(raw.providerModelOptions),
          sessionPersistenceEnabled: raw.sessionPersistenceEnabled === true,
          sessionRetentionDays: raw.sessionRetentionDays ?? 30,
          sessionMaxStorageMb: raw.sessionMaxStorageMb ?? 200,
          windowBounds: raw.windowBounds,
        },
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      log.error(`SETTINGS_GET failed: ${message}`)
      return { success: false, error: message }
    }
  })

  // --- GET_CATALOG: 返回可演进的供应商 + 模型目录 ---
  ipcMain.handle(SETTINGS_GET_CATALOG, async () => {
    try {
      const catalog = loadCatalog()
      return {
        success: true,
        data: catalog,
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      log.error('SETTINGS_GET_CATALOG failed', err)
      return { success: false, error: message }
    }
  })

  // --- SAVE: Persist settings（明文 JSON；仅保留一个供应商） ---
  ipcMain.handle(SETTINGS_SAVE, async (_event, payload: SettingsPayload) => {
    try {
      if (payload.theme !== undefined) {
        store.set('theme', payload.theme)
      }
      if (payload.providers !== undefined) {
        const incoming = payload.providers.slice(0, 1)
        // apiKey 若为含 *** 的占位串，合并为仓库中的明文（见 resolveApiKeyForPersist）
        const existingProviders = (store.get('providers') || []) as ProviderConfig[]
        const existingMap = new Map(existingProviders.map((p) => [p.id, p]))

        const merged = incoming.map((p) => {
          const { keepExistingKey: _hint, ...rest } = p as ProviderConfig & {
            keepExistingKey?: boolean
          }
          const apiKey = resolveApiKeyForPersist(rest.apiKey ?? '', rest.id, existingMap)
          return { ...rest, apiKey }
        })

        for (const p of merged) {
          if (!p.id || !p.id.trim()) {
            return { success: false, error: '保存失败：供应商 ID 不能为空' }
          }
          if (!p.name || !p.name.trim()) {
            return { success: false, error: '保存失败：供应商名称不能为空' }
          }
          if (!p.model || !p.model.trim()) {
            return { success: false, error: '保存失败：模型不能为空' }
          }
          if (!p.apiKey || !p.apiKey.trim()) {
            return { success: false, error: '保存失败：API Key 不能为空' }
          }
          if (p.type === 'anthropic_compat' && (!p.baseUrl || !p.baseUrl.trim())) {
            return { success: false, error: '保存失败：Anthropic 兼容模式必须填写请求地址' }
          }

          // 检查模型是否在 catalog 中有效（标准供应商）
          const catalog = loadCatalog()
          const standardProviderIds = new Set(['anthropic', 'openai', 'deepseek', 'kimi', 'glm', 'qwen'])
          if (standardProviderIds.has(p.id)) {
            if (!isModelValid(p.id, p.model, catalog)) {
              log.warn(`Model not found or inactive in catalog: provider=${p.id}, model=${p.model}`)
              // 记录警告但不阻止保存，允许用户继续使用旧模型（P1 时会增强提示）
            }
          }
        }

        store.set('providers', merged)
      }
      if (payload.activeProvider !== undefined) {
        store.set('activeProvider', payload.activeProvider)
      }
      if (payload.configured !== undefined) {
        store.set('configured', payload.configured)
      }
      if (typeof payload.onboardingCompleted === 'boolean') {
        store.set('onboardingCompleted', payload.onboardingCompleted)
      }
      if (payload.readingPreferences !== undefined) {
        store.set('readingPreferences', normalizeReadingPreferences(payload.readingPreferences))
      }
      if (payload.providerModelOptions !== undefined) {
        const previous = normalizeProviderModelOptions(store.get('providerModelOptions'))
        store.set('providerModelOptions', {
          ...previous,
          ...normalizeProviderModelOptions(payload.providerModelOptions),
        })
      }
      if (typeof payload.sessionPersistenceEnabled === 'boolean') store.set('sessionPersistenceEnabled', payload.sessionPersistenceEnabled)
      if (Number.isFinite(payload.sessionRetentionDays)) store.set('sessionRetentionDays', Math.min(365, Math.max(1, Math.round(payload.sessionRetentionDays!))))
      if (Number.isFinite(payload.sessionMaxStorageMb)) store.set('sessionMaxStorageMb', Math.min(2048, Math.max(16, Math.round(payload.sessionMaxStorageMb!))))

      // Auto-compute configured status: any provider with a non-empty key
      const savedProviders = (store.get('providers') || []) as ProviderConfig[]
      const hasConfigured = savedProviders.some((p) => p.apiKey && p.apiKey.length > 0)
      store.set('configured', hasConfigured)

      syncNativeChromeTheme()

      return { success: true }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      log.error(`SETTINGS_SAVE failed: ${message}`)
      return { success: false, error: message }
    }
  })

  // --- TEST CONNECTION: 仅探测连通性，不写全局配置与工作区 config ---
  ipcMain.handle(SETTINGS_TEST_CONNECTION, async (_event, payload: TestConnectionPayload) => {
    try {
      const apiKey = resolveApiKeyForTest(payload)
      return await runProviderConnectivityTest({ ...payload, apiKey })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      log.error('SETTINGS_TEST_CONNECTION failed', err)
      return { success: false, error: message }
    }
  })

  ipcMain.handle(SETTINGS_LIST_MODELS, async (_event, payload: ListModelsPayload) => {
    try {
      return await listProviderModels(payload)
    } catch (err) {
      log.error('SETTINGS_LIST_MODELS failed', err)
      return { success: false, error: '获取模型列表失败' }
    }
  })

}
