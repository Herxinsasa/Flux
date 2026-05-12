import { app, ipcMain } from 'electron'
import { IPC_CHANNELS } from '../../shared/ipc-channels'
import store from '../store/index'
import log from '../logger'
import { syncNativeChromeTheme } from '../native-theme'
import {
  ensureWorkspaceConfig,
  syncSupplierFromProviderState,
  updateSupplierConnectionStatus,
} from '../services/workspace-config-service'
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
  /** 若设置，保存后将供应商摘要同步到该工作区下的 config/config.json（不含 API Key） */
  workspaceRoot?: string | null
}

type TestConnectionPayload = ProviderConfig

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
  const baseUrl = config.baseUrl || 'https://api.anthropic.com'
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 15000)

  try {
    const response = await fetch(`${baseUrl}/v1/messages`, {
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
      })
      return { success: false, error: '连接超时 (15s) — 请检查 Base URL 是否正确' }
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
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 15000)

  try {
    const response = await fetch(`${baseUrl}/v1/chat/completions`, {
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
      })
      return { success: false, error: '连接超时 (15s) — 请检查 Base URL 是否正确' }
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
        return { success: false, error: '请先设置 Base URL' }
      }
      return await testAnthropicConnection(config)
    case 'openai_compat':
      return await testOpenAICompatConnection(config)
    default:
      return { success: false, error: `不支持的提供商类型: ${(config as ProviderConfig).type}` }
  }
}

export function registerSettingsHandlers(): void {
  const { APP_GET_VERSION, SETTINGS_SAVE, SETTINGS_GET, SETTINGS_GET_CATALOG, SETTINGS_TEST_CONNECTION, SETTINGS_WORKSPACE_VERIFY } = IPC_CHANNELS

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
            return { success: false, error: '保存失败：Anthropic 兼容模式必须填写 Base URL' }
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

      // Auto-compute configured status: any provider with a non-empty key
      const savedProviders = (store.get('providers') || []) as ProviderConfig[]
      const hasConfigured = savedProviders.some((p) => p.apiKey && p.apiKey.length > 0)
      store.set('configured', hasConfigured)

      syncNativeChromeTheme()

      // 同步工作区 config/config.json（供应商元数据，不含 API Key）
      if (payload.workspaceRoot && typeof payload.workspaceRoot === 'string') {
        const wsRoot = payload.workspaceRoot.trim()
        if (wsRoot) {
          const savedProviders = (store.get('providers') || []) as ProviderConfig[]
          const activeId = store.get('activeProvider')
          const p = savedProviders.find((x) => x.id === activeId) ?? savedProviders[0]
          if (p) {
            syncSupplierFromProviderState(wsRoot, {
              name: p.name,
              type: p.type,
              model: p.model,
              baseUrl: p.baseUrl ?? '',
              setupComplete: !!(p.apiKey && p.apiKey.trim().length > 0),
            })
          }
        }
      }

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

  /** 启动或打开工作区后：若配置标记已完成供应商设置，则用磁盘配置 + 本地密钥自动测通一次 */
  ipcMain.handle(SETTINGS_WORKSPACE_VERIFY, async (_event, workspaceRoot: string) => {
    try {
      if (!workspaceRoot || typeof workspaceRoot !== 'string') {
        return { success: false, skipped: true as const, error: '无效的工作区路径' }
      }
      const root = workspaceRoot.trim()
      if (!root) {
        return { success: false, skipped: true as const, error: '无效的工作区路径' }
      }

      const fileCfg = ensureWorkspaceConfig(root)
      if (!fileCfg.supplier.setupComplete) {
        return { success: true, skipped: true as const }
      }

      const providers = (store.get('providers') || []) as ProviderConfig[]
      const activeId = store.get('activeProvider')
      const p = providers.find((x) => x.id === activeId) ?? providers[0]
      if (!p?.apiKey?.trim()) {
        return { success: true, skipped: true as const }
      }

      const merged: ProviderConfig = {
        ...p,
        name: fileCfg.supplier.name || p.name,
        type: fileCfg.supplier.type,
        model: fileCfg.supplier.model || p.model,
        baseUrl:
          fileCfg.supplier.type === 'anthropic'
            ? p.baseUrl
            : fileCfg.supplier.baseUrl !== ''
              ? fileCfg.supplier.baseUrl
              : p.baseUrl,
      }

      const result = await runProviderConnectivityTest({
        ...merged,
        apiKey: resolveApiKeyForTest(merged),
      })
      updateSupplierConnectionStatus(root, result.success, result.error)
      return { ...result, skipped: false as const }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      log.error('SETTINGS_WORKSPACE_VERIFY failed', err)
      return { success: false, skipped: false as const, error: message }
    }
  })
}
