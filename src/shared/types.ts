// IPC request/response type definitions

export interface FileInfo {
  path: string;
  name: string;
  size: number;
  lines: number;
  encoding: string;
  extension: string;
}

/** 打开文件夹后列出的工作区文件（相对根目录路径） */
export interface WorkspaceFileEntry {
  path: string;
  relativePath: string;
}

/** 工作区 config/config.json 中的供应商信息（不含 API Key） */
export interface WorkspaceSupplierConfig {
  name: string;
  type: 'anthropic' | 'anthropic_compat' | 'openai_compat';
  model: string;
  baseUrl: string;
  /** 用户已完成密钥等信息配置（由保存设置时写入） */
  setupComplete: boolean;
  /** 最近一次连通性测试结果；尚未测试为 null */
  connectionOk: boolean | null;
  lastConnectionError: string | null;
  lastConnectionCheckAt: string | null;
}

/** 与磁盘 config.json 对齐，供 IPC 传递 */
export interface WorkspaceConfigFilePayload {
  version: 1;
  supplier: WorkspaceSupplierConfig;
}

export interface WorkspaceOpenData {
  root: string;
  files: WorkspaceFileEntry[];
  /** 已确保存在的 config/config.json 解析结果 */
  workspaceConfig: WorkspaceConfigFilePayload;
}

export interface IpcResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

export type ProgressCallback = (progress: { loaded: number; total: number }) => void;

export interface SkillMeta {
  name: string;
  description: string;
  keywords: string[];
  builtin: boolean;
  enabled: boolean;
  source: 'builtin' | 'user';
  /** 主入口 Markdown（含 YAML frontmatter） */
  filePath: string;
  /**
   * 用户从「目录」导入时：技能包根目录（内含脚本、模板等）。
   * 运行时仅注入正文与目录清单到模型上下文，不执行脚本；Agent 工具若需读文件应使用此绝对路径。
   */
  contentRoot?: string;
  /** 技能资源是否失效（文件或目录缺失） */
  invalid?: boolean;
  /** 失效原因（用于 UI 明确提示） */
  invalidReason?: string;
}

export interface Skill extends SkillMeta {
  content: string;
}

export type SkillListResult = SkillMeta[];

export interface SkillTogglePayload {
  name: string;
  enabled: boolean;
}
/** 供应商 Catalog：可演进的模型与端点目录（与代码解耦） */
export interface CatalogModel {
  id: string
  label: string
  /** active / deprecated / removed（已下线） */
  status: 'active' | 'deprecated' | 'removed'
  /** 若已弃用，建议用户迁移到此模型 */
  replacement?: string
}

export interface CatalogProvider {
  id: string
  label: string
  type: 'anthropic' | 'anthropic_compat' | 'openai_compat'
  baseUrl: string
  defaultModel: string
  models: CatalogModel[]
}

export interface ProvidersCatalog {
  version: 1
  providers: CatalogProvider[]
}