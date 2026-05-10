import fs from 'fs'
import path from 'path'
import log from '../logger'
import { getConfigDir } from '../paths'
import type { ProvidersCatalog, CatalogProvider, CatalogModel } from '../../shared/types'

// 内置默认 Catalog（来自 providerModels.ts 硬编码的回退兜底）
const BUILTIN_CATALOG: ProvidersCatalog = {
  version: 1,
  providers: [
    {
      id: 'anthropic',
      label: 'Anthropic',
      type: 'anthropic',
      baseUrl: 'https://api.anthropic.com',
      defaultModel: 'claude-opus-4-7',
      models: [
        { id: 'claude-opus-4-7', label: 'Claude Opus 4.7', status: 'active' },
        { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6', status: 'active' },
        { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5', status: 'active' },
      ],
    },
    {
      id: 'openai',
      label: 'OpenAI',
      type: 'openai_compat',
      baseUrl: '',
      defaultModel: 'gpt-5.5',
      models: [
        { id: 'gpt-5.5', label: 'GPT 5.5', status: 'active' },
        { id: 'gpt-4.1', label: 'GPT 4.1', status: 'active' },
        { id: 'gpt-4o', label: 'GPT 4o', status: 'active' },
        { id: 'gpt-4o-mini', label: 'GPT 4o mini', status: 'active' },
        { id: 'o4-mini', label: 'o4 mini', status: 'active' },
      ],
    },
    {
      id: 'deepseek',
      label: 'DeepSeek',
      type: 'openai_compat',
      baseUrl: 'https://api.deepseek.com',
      defaultModel: 'deepseek-v4-flash',
      models: [
        { id: 'deepseek-v4-flash', label: 'DeepSeek V4 Flash', status: 'active' },
        { id: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro', status: 'active' },
        { id: 'deepseek-chat', label: 'DeepSeek Chat', status: 'active' },
        { id: 'deepseek-reasoner', label: 'DeepSeek Reasoner', status: 'active' },
        { id: 'deepseek-coder', label: 'DeepSeek Coder', status: 'active' },
      ],
    },
    {
      id: 'kimi',
      label: 'Kimi',
      type: 'openai_compat',
      baseUrl: 'https://api.moonshot.cn',
      defaultModel: 'kimi-k2-turbo',
      models: [
        { id: 'kimi-k2-turbo', label: 'Kimi K2 Turbo', status: 'active' },
        { id: 'moonshot-v1-128k', label: 'Moonshot v1 128k', status: 'active' },
        { id: 'moonshot-v1-32k', label: 'Moonshot v1 32k', status: 'active' },
        { id: 'moonshot-v1-8k', label: 'Moonshot v1 8k', status: 'active' },
      ],
    },
    {
      id: 'glm',
      label: 'GLM',
      type: 'openai_compat',
      baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
      defaultModel: 'glm-4.6',
      models: [
        { id: 'glm-4.6', label: 'GLM 4.6', status: 'active' },
        { id: 'glm-4-plus', label: 'GLM 4 Plus', status: 'active' },
        { id: 'glm-4-flash', label: 'GLM 4 Flash', status: 'active' },
        { id: 'glm-4-air', label: 'GLM 4 Air', status: 'active' },
      ],
    },
    {
      id: 'qwen',
      label: 'Qwen',
      type: 'openai_compat',
      baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      defaultModel: 'qwen-plus',
      models: [
        { id: 'qwen3-max', label: 'Qwen3 Max', status: 'active' },
        { id: 'qwen-plus', label: 'Qwen Plus', status: 'active' },
        { id: 'qwen-turbo', label: 'Qwen Turbo', status: 'active' },
        { id: 'qwen-long', label: 'Qwen Long', status: 'active' },
      ],
    },
  ],
}

/** 获取 catalog 文件路径 */
function getCatalogPath(): string {
  return path.join(getConfigDir(), 'providers-catalog.json')
}

/** 读取 catalog，优先本地文件，回退内置默认 */
export function loadCatalog(): ProvidersCatalog {
  const filePath = getCatalogPath()
  try {
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, 'utf-8')
      const parsed = JSON.parse(content) as ProvidersCatalog
      if (parsed.version === 1 && Array.isArray(parsed.providers)) {
        log.info('Loaded providers catalog from', filePath)
        return parsed
      }
    }
  } catch (err) {
    log.warn('Failed to load providers catalog, falling back to builtin', err)
  }
  log.info('Using builtin providers catalog')
  return BUILTIN_CATALOG
}

/** 校验指定 provider/model 是否有效且 active */
export function isModelValid(providerId: string, modelId: string, catalog: ProvidersCatalog): boolean {
  const provider = catalog.providers.find((p) => p.id === providerId)
  if (!provider) return false
  const model = provider.models.find((m) => m.id === modelId)
  if (!model) return false
  return model.status === 'active'
}

/** 获取指定 model 的替代项（若已 deprecated） */
export function getModelReplacement(
  providerId: string,
  modelId: string,
  catalog: ProvidersCatalog,
): string | null {
  const provider = catalog.providers.find((p) => p.id === providerId)
  if (!provider) return null
  const model = provider.models.find((m) => m.id === modelId)
  if (!model || model.status !== 'deprecated' || !model.replacement) return null
  return model.replacement
}

/** 获取指定供应商的所有 active 模型 */
export function getActiveModels(providerId: string, catalog: ProvidersCatalog): CatalogModel[] {
  const provider = catalog.providers.find((p) => p.id === providerId)
  if (!provider) return []
  return provider.models.filter((m) => m.status === 'active')
}

/** 获取指定供应商信息 */
export function getProvider(providerId: string, catalog: ProvidersCatalog): CatalogProvider | null {
  return catalog.providers.find((p) => p.id === providerId) || null
}
