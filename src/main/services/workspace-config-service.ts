import fs from 'fs'
import path from 'path'
import log from '../logger'
import type { WorkspaceConfigFilePayload, WorkspaceSupplierConfig } from '../../shared/types'

const CONFIG_FILE = 'config.json'
const REL_CONFIG_DIR = 'config'

const DEFAULT_SUPPLIER: WorkspaceSupplierConfig = {
  name: 'Claude',
  type: 'anthropic',
  model: 'claude-opus-4-7',
  baseUrl: '',
  setupComplete: false,
  connectionOk: null,
  lastConnectionError: null,
  lastConnectionCheckAt: null,
}

function configPath(workspaceRoot: string): string {
  return path.join(path.resolve(workspaceRoot), REL_CONFIG_DIR, CONFIG_FILE)
}

function parseSupplier(raw: unknown): WorkspaceSupplierConfig {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_SUPPLIER }
  const s = raw as Record<string, unknown>
  const type = s.type === 'anthropic_compat' || s.type === 'openai_compat' ? s.type : 'anthropic'
  return {
    name: typeof s.name === 'string' && s.name.trim() ? s.name : DEFAULT_SUPPLIER.name,
    type,
    model: typeof s.model === 'string' && s.model.trim() ? s.model : DEFAULT_SUPPLIER.model,
    baseUrl: typeof s.baseUrl === 'string' ? s.baseUrl : '',
    setupComplete: s.setupComplete === true,
    connectionOk: s.connectionOk === true ? true : s.connectionOk === false ? false : null,
    lastConnectionError: typeof s.lastConnectionError === 'string' ? s.lastConnectionError : null,
    lastConnectionCheckAt: typeof s.lastConnectionCheckAt === 'string' ? s.lastConnectionCheckAt : null,
  }
}

function readOrCreateFile(workspaceRoot: string): WorkspaceConfigFilePayload {
  const dir = path.join(path.resolve(workspaceRoot), REL_CONFIG_DIR)
  const file = path.join(dir, CONFIG_FILE)

  try {
    fs.mkdirSync(dir, { recursive: true })
  } catch (e) {
    log.error(`[workspace-config] mkdir failed: ${String(e)}`)
  }

  if (!fs.existsSync(file)) {
    const initial: WorkspaceConfigFilePayload = { version: 1, supplier: { ...DEFAULT_SUPPLIER } }
    try {
      fs.writeFileSync(file, JSON.stringify(initial, null, 2), 'utf8')
      log.info(`[workspace-config] created ${file}`)
    } catch (e) {
      log.error(`[workspace-config] write default failed: ${String(e)}`)
    }
    return initial
  }

  try {
    const raw = fs.readFileSync(file, 'utf8')
    const parsed = JSON.parse(raw) as unknown
    if (parsed && typeof parsed === 'object' && 'supplier' in (parsed as object)) {
      return {
        version: 1,
        supplier: parseSupplier((parsed as WorkspaceConfigFilePayload).supplier),
      }
    }
  } catch (e) {
    log.warn(`[workspace-config] parse failed, using defaults: ${String(e)}`)
  }

  const fallback: WorkspaceConfigFilePayload = { version: 1, supplier: { ...DEFAULT_SUPPLIER } }
  try {
    fs.writeFileSync(file, JSON.stringify(fallback, null, 2), 'utf8')
  } catch {
    // ignore
  }
  return fallback
}

/** 确保存在 config/config.json 并返回解析结果（不存在则创建，默认 Claude / anthropic）。 */
export function ensureWorkspaceConfig(workspaceRoot: string): WorkspaceConfigFilePayload {
  return readOrCreateFile(workspaceRoot)
}

export function writeWorkspaceConfig(workspaceRoot: string, data: WorkspaceConfigFilePayload): void {
  const file = configPath(workspaceRoot)
  const dir = path.dirname(file)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8')
}

/** 根据当前提供商摘要写入工作区配置（不包含 API Key）。 */
export function syncSupplierFromProviderState(
  workspaceRoot: string,
  supplier: Partial<WorkspaceSupplierConfig>,
): void {
  const current = ensureWorkspaceConfig(workspaceRoot)
  writeWorkspaceConfig(workspaceRoot, {
    version: 1,
    supplier: {
      ...current.supplier,
      ...supplier,
    },
  })
}

export function updateSupplierConnectionStatus(
  workspaceRoot: string,
  ok: boolean,
  errorMessage?: string,
): void {
  const current = ensureWorkspaceConfig(workspaceRoot)
  const now = new Date().toISOString()
  writeWorkspaceConfig(workspaceRoot, {
    version: 1,
    supplier: {
      ...current.supplier,
      connectionOk: ok,
      lastConnectionError: ok ? null : (errorMessage ?? '未知错误'),
      lastConnectionCheckAt: now,
    },
  })
}
