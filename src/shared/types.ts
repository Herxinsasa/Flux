// IPC request/response type definitions

export interface FileInfo {
  path: string;
  name: string;
  size: number;
  lines: number;
  encoding: string;
  extension: string;
}

export type FluxErrorCode =
  | 'NOT_FOUND'
  | 'PERMISSION_DENIED'
  | 'UNSUPPORTED_FORMAT'
  | 'ENCODING_UNREPRESENTABLE'
  | 'VERSION_CONFLICT'
  | 'INVALID_DATA'
  | 'CANCELLED'
  | 'TIMEOUT'
  | 'QUOTA_EXCEEDED'
  | 'IO_ERROR';

export type TextEncoding = 'utf8' | 'utf8-bom' | 'gbk' | 'utf16le' | 'utf16be';

export type LineEnding = 'lf' | 'crlf';

export interface FileVersion {
  mtimeMs: number;
  size: number;
  contentHash: string;
}

export interface TextDocumentSnapshot {
  filePath: string;
  content: string;
  encoding: TextEncoding;
  lineEnding: LineEnding;
  version: FileVersion;
  sampled: boolean;
}

export interface SaveTextRequest {
  filePath: string;
  content: string;
  encoding: TextEncoding;
  lineEnding: LineEnding;
  expectedVersion: FileVersion;
}

export interface SaveTextResult {
  version: FileVersion;
}

/** 打开文件夹后列出的工作区文件（相对根目录路径） */
export interface WorkspaceFileEntry {
  path: string;
  relativePath: string;
  /** 旧版未携带 kind，缺省时按文件处理。 */
  kind?: 'file' | 'directory';
}

export interface TaskStartData {
  taskId: string
}

export interface WorkspaceScanEvent {
  taskId: string
  status: 'batch' | 'complete' | 'cancelled' | 'error'
  entries?: WorkspaceFileEntry[]
  error?: string
}

export interface WorkspaceChangeEvent {
  watchId: string
  root: string
}

export interface WorkspaceOpenData {
  root: string;
  files: WorkspaceFileEntry[];
}

export interface IpcResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  code?: FluxErrorCode;
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

/** Log index built by main process (P2) */
export interface LogIndexPayload {
  path: string
  sizeBytes: number
  totalLines: number
  encoding: string
  levelCounts: {
    fatal: number
    error: number
    warn: number
    info: number
    debug: number
  }
  /** Representative error/warn line numbers (1-based), capped */
  errorSampleLines: number[]
  warnSampleLines: number[]
  /** ≤2KB text for AI context injection */
  summaryText: string
}

export interface LogReadLinesPayload {
  path: string
  startLine: number
  endLine: number
  totalLines: number
  lines: string[]
}

/** P3: .flux/session-summary.md payload */
export interface WorkspaceSessionPayload {
  pinnedFacts: string[]
  workingSummary: string | null
}

export interface LogIndexTaskEvent {
  taskId: string
  status: 'progress' | 'complete' | 'cancelled' | 'error'
  loadedBytes?: number
  totalBytes?: number
  data?: LogIndexPayload
  error?: string
}
