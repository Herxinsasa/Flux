/**
 * 各厂商 / 预设对应的模型 ID（参考各平台公开文档；实际以控制台为准）。
 *
 * Anthropic：带日期的 id（如 claude-opus-4-20250514）为「快照版」API 名，用于锁定某次发布的行为与计费；
 * 无日期或短别名（如 claude-opus-4-7）多为当前推荐的稳定别名，具体以 Anthropic 控制台为准。
 *
 * DeepSeek：`deepseek-v4-flash` / `deepseek-v4-pro` 为 V4 代主力；`deepseek-chat` 多为通用对话（非思考）、
 * `deepseek-reasoner` 为带链式推理/「思考」倾向的型号（名称随官方文档调整，请以 DeepSeek 控制台为准）。
 */

/**
 * Naming Conventions:
 * - Provider names: lowercase, no spaces (e.g., 'anthropic', 'openai_compat').
 * - Model names: prefer stable mainstream aliases; avoid dated snapshots in defaults.
 */

import type { Provider } from '../stores/settingsStore'

/** Anthropic Messages API（含无日期别名与带日期的快照 id） */
export const ANTHROPIC_MODEL_IDS = [
  'claude-opus-4-7',
  'claude-sonnet-4-6',
  'claude-haiku-4-5',
]

/** OpenAI 官方兼容（api.openai.com 或默认 OpenAI 预设） */
export const OPENAI_OFFICIAL_MODEL_IDS = [
  'gpt-5.5',
  'gpt-4.1',
  'gpt-4o',
  'gpt-4o-mini',
  'o4-mini',
]

export const DEEPSEEK_MODEL_IDS = [
  'deepseek-v4-flash',
  'deepseek-v4-pro',
  'deepseek-chat',
  'deepseek-reasoner',
  'deepseek-coder',
]

export const KIMI_MODEL_IDS = [
  'kimi-k2-turbo',
  'moonshot-v1-128k',
  'moonshot-v1-32k',
  'moonshot-v1-8k',
]

export const GLM_MODEL_IDS = ['glm-4.6', 'glm-4-plus', 'glm-4-flash', 'glm-4-air']

export const QWEN_MODEL_IDS = [
  'qwen3-max',
  'qwen-plus',
  'qwen-turbo',
  'qwen-long',
]

export interface ProviderPresetConfig {
  label: string
  type: Provider['type']
  baseUrl?: string
  defaultModel: string
  /** 该预设下模型下拉候选项 */
  modelIds: string[]
}

export const PROVIDER_PRESETS: Record<string, ProviderPresetConfig> = {
  anthropic: {
    label: 'Anthropic',
    type: 'anthropic',
    defaultModel: 'claude-opus-4-7',
    modelIds: ANTHROPIC_MODEL_IDS,
  },
  openai: {
    label: 'OpenAI',
    type: 'openai_compat',
    defaultModel: 'gpt-5.5',
    modelIds: OPENAI_OFFICIAL_MODEL_IDS,
  },
  deepseek: {
    label: 'DeepSeek',
    type: 'openai_compat',
    baseUrl: 'https://api.deepseek.com',
    defaultModel: 'deepseek-v4-flash',
    modelIds: DEEPSEEK_MODEL_IDS,
  },
  kimi: {
    label: 'Kimi',
    type: 'openai_compat',
    baseUrl: 'https://api.moonshot.cn',
    defaultModel: 'kimi-k2-turbo',
    modelIds: KIMI_MODEL_IDS,
  },
  glm: {
    label: 'GLM',
    type: 'openai_compat',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    defaultModel: 'glm-4.6',
    modelIds: GLM_MODEL_IDS,
  },
  qwen: {
    label: 'Qwen',
    type: 'openai_compat',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    defaultModel: 'qwen-plus',
    modelIds: QWEN_MODEL_IDS,
  },
  custom: {
    label: '自定义',
    type: 'openai_compat',
    defaultModel: 'gpt-5.5',
    modelIds: [
      ...OPENAI_OFFICIAL_MODEL_IDS,
      ...DEEPSEEK_MODEL_IDS,
      ...KIMI_MODEL_IDS,
      ...GLM_MODEL_IDS,
      ...QWEN_MODEL_IDS,
      ...ANTHROPIC_MODEL_IDS,
    ],
  },
}

function modelIdsForOpenAiCompatBaseUrl(baseUrl: string): string[] {
  const u = baseUrl.toLowerCase()
  if (u.includes('deepseek')) return DEEPSEEK_MODEL_IDS
  if (u.includes('moonshot')) return KIMI_MODEL_IDS
  if (u.includes('bigmodel')) return GLM_MODEL_IDS
  if (u.includes('dashscope') || u.includes('aliyuncs')) return QWEN_MODEL_IDS
  return OPENAI_OFFICIAL_MODEL_IDS
}

/** 设置页「当前上下文」下应展示的模型 ID 列表 */
export function getModelIdsForSettings(params: {
  presetKey: string
  activeProvider: Provider | null
  /** 表单中的 baseUrl（新建或未选提供商时用于识别国产端点） */
  formBaseUrl: string
}): string[] {
  const { activeProvider, presetKey, formBaseUrl } = params

  if (activeProvider) {
    if (activeProvider.type === 'anthropic' || activeProvider.type === 'anthropic_compat') {
      return [...ANTHROPIC_MODEL_IDS]
    }
    if (activeProvider.type === 'openai_compat') {
      const url = (activeProvider.baseUrl || '').trim() || formBaseUrl
      return modelIdsForOpenAiCompatBaseUrl(url || 'https://api.openai.com')
    }
  }

  const preset = PROVIDER_PRESETS[presetKey] ?? PROVIDER_PRESETS.custom
  if (preset.type === 'anthropic') return preset.modelIds
  const url = (preset.baseUrl || formBaseUrl || '').trim()
  if (preset.type === 'openai_compat' && url) {
    return modelIdsForOpenAiCompatBaseUrl(url)
  }
  if (presetKey === 'openai') return OPENAI_OFFICIAL_MODEL_IDS
  return preset.modelIds
}

/** 若 current 不在 options 中，将其插在首位，避免已保存的自定义模型 ID 消失 */
export function mergeCurrentModelOption(current: string, options: string[]): string[] {
  const c = current.trim()
  if (!c) return [...options]
  const set = new Set(options)
  if (set.has(c)) return [...options]
  return [c, ...options]
}

export function defaultModelForPresetKey(presetKey: string): string {
  return PROVIDER_PRESETS[presetKey]?.defaultModel ?? 'gpt-5.5'
}

/** 根据已保存提供商推断设置页「预设类型」键，避免重新进入设置时落回 anthropic */
export function inferPresetKeyFromProvider(p: Provider | null): keyof typeof PROVIDER_PRESETS {
  if (!p) return 'anthropic'
  if (p.type === 'anthropic') return 'anthropic'
  if (p.type === 'anthropic_compat') return 'custom'
  const url = (p.baseUrl || '').trim().toLowerCase()
  if (!url || url.includes('api.openai.com')) return 'openai'
  if (url.includes('deepseek')) return 'deepseek'
  if (url.includes('moonshot')) return 'kimi'
  if (url.includes('bigmodel')) return 'glm'
  if (url.includes('dashscope') || url.includes('aliyuncs')) return 'qwen'
  return 'custom'
}
