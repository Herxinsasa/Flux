# baseline2.0 团队 AI Markdown 编辑器需求设计

> 状态：已确认（代理自审）
> 基线：`d4761fd1554162dae77c125b1b020146c8019477`
> 需求规格：`docs/requirements/baseline2.0-team-ai-markdown-req.md`
> 影响分析：`docs/requirements/baseline2.0-team-ai-markdown-impact.md`
> 界面契约：`docs/ui/baseline2.0-team-ai-markdown-ui.md`

## 1. 范围与总体决策

baseline2.0 是 Windows 首发的本地文本工具，支持 MD/TXT/LOG；不引入 Office/PDF、云同步、多人实时协作或服务端。Electron Main 负责文件系统、发行路径、原子持久化和长任务；Preload 只暴露类型化 IPC；Renderer 负责交互与会话内状态。

核心决策：

1. 主编辑区先保证源码无损、阅读清晰和分栏稳定。现有 MDXEditor 只有通过往返测试后才作为“编辑”模式启用，不以 UI 名称承诺未验证能力。
2. 所有文件写回共用一个带基线版本、编码和原子替换的保存服务，人工保存与 AI 修改不得分叉。
3. 批注以 `<原文件>.review.json` 为唯一持久化真相；AI 评审结果只有用户接受后才进入侧车。
4. 安装版数据根使用 `app.getPath('userData')`；Portable 仅使用可执行文件旁 `data`。二者配置、缓存、日志、会话和 Skill 完全隔离。
5. AI 会话存储从工作区迁到私有 userData，事件使用 JSONL，摘要使用原子 checkpoint；`/compact` 先持久化成功再切换活动摘要。
6. 大目录和大日志工作不得在 Electron 主线程执行同步全量扫描；任务都必须可取消并忽略过期结果。

## 2. 模块边界

| 模块 | 职责 | 禁止承担 |
|---|---|---|
| `src/shared` | IPC 名称、DTO、schema 类型、错误码 | 文件系统实现与 UI 状态 |
| `src/main/paths.ts` | 识别发行形态并给出稳定数据根 | 业务文件路径与工作区侧车路径 |
| Main services | 文件、review、backup、session、recent、附件、日志索引 | React 状态和视觉反馈 |
| Main IPC handlers | 参数校验、服务调用、错误归一化 | 复制业务算法 |
| Preload | 最小类型化桥接和 Main 事件订阅 | Node 对象泄漏给 Renderer |
| Renderer stores | 文档会话、布局、批注、AI 结果和偏好 | 直接访问文件系统 |
| Renderer UI | 契约中的状态与交互 | 自行持久化关键业务数据 |

## 3. 公共数据契约

### 3.1 通用结果与文件版本

```ts
type FluxErrorCode =
  | 'NOT_FOUND' | 'PERMISSION_DENIED' | 'UNSUPPORTED_FORMAT'
  | 'ENCODING_UNREPRESENTABLE' | 'VERSION_CONFLICT'
  | 'INVALID_DATA' | 'CANCELLED' | 'QUOTA_EXCEEDED' | 'IO_ERROR'

interface FileVersion {
  mtimeMs: number
  size: number
  contentHash: string
}

interface TextDocumentSnapshot {
  filePath: string
  content: string
  encoding: 'utf8' | 'utf8-bom' | 'gbk' | 'utf16le' | 'utf16be'
  lineEnding: 'lf' | 'crlf'
  version: FileVersion
  sampled: boolean
}
```

Renderer 打开文件后保存完整 `TextDocumentSnapshot` 元数据。保存请求必须携带 `expectedVersion`、`encoding` 和 `lineEnding`；Main 写前复核磁盘版本，冲突返回 `VERSION_CONFLICT`，不得覆盖。

### 3.2 文档会话

```ts
interface OpenDocumentState {
  filePath: string
  snapshot: TextDocumentSnapshot
  draft: string
  dirty: boolean
  mode: 'text' | 'markdown-source' | 'markdown-read' | 'markdown-split' | 'log'
  selection?: { from: number; to: number }
  scrollTop: number
  lastActivatedAt: number
}
```

`fileStore` 管理打开顺序与 MRU，`editorStore` 管理以规范化文件路径为 key 的文档状态。切换文件不再把单一全局正文覆盖到新文件；只有关闭脏文件触发确认。

### 3.3 批注侧车

```ts
interface ReviewAnchor {
  start: number
  end: number
  quote: string
  prefix: string
  suffix: string
  sourceHash: string
}

interface ReviewComment {
  id: string
  anchor: ReviewAnchor
  body: string
  author: 'user' | 'ai'
  status: 'open' | 'resolved'
  anchorStatus: 'valid' | 'relocated' | 'orphaned'
  createdAt: string
  updatedAt: string
}

interface ReviewSidecar {
  schemaVersion: 1
  sourcePath: string
  sourceHash: string
  comments: ReviewComment[]
  updatedAt: string
}
```

文件名固定为 `<原文件完整名称>.review.json`，例如 `a.md.review.json`。JSON 使用 UTF-8、2 空格缩进、按正文位置和创建时间稳定排序。空批注集合删除侧车；写入使用同目录临时文件加 rename。加载时先校验 schema；损坏文件只读保留并返回 `INVALID_DATA`，不自动重写。

重锚顺序：精确字符范围且 quote 匹配；在原位置附近匹配 prefix+quote+suffix；全文唯一 quote；否则标记 `orphaned`。禁止静默绑定到多个候选中的任意一个。

### 3.4 最近项与偏好

```ts
interface RecentItem {
  path: string
  kind: 'file' | 'folder'
  openedAt: number
}

interface ReadingPreferences {
  uiFontFamily: string
  editorFontFamily: string
  monoFontFamily: string
  bodyFontSize: number
  codeFontSize: number
}
```

主配置增加 `schemaVersion: 2`、`recentItems`（最多 10 项）、`onboardingCompleted`、`readingPreferences`。迁移只补默认值，不覆盖 V1 Provider、主题和模型配置。路径以 Windows 大小写不敏感规则去重；存在性校验在点击时或后台低优先级执行，不阻塞首屏。

### 3.5 备份清单

```ts
interface BackupManifestEntry {
  id: string
  sourcePath: string
  sourceVersion: FileVersion
  draftHash: string
  encoding: TextDocumentSnapshot['encoding']
  lineEnding: TextDocumentSnapshot['lineEnding']
  createdAt: number
  size: number
}
```

快照正文和 manifest 分开存储，快照文件名使用源路径 hash、时间戳和内容 hash，不泄漏原路径到文件名。每个源文件最多 20 份，全局最多 500MB；先清理超过 30 天，再按最旧访问时间淘汰。清理失败不得阻止编辑。

### 3.6 AI 会话

```ts
interface SessionMeta {
  schemaVersion: 1
  sessionId: string
  workspacePath?: string
  title: string
  createdAt: number
  updatedAt: number
  activeCheckpointId?: string
}

interface SessionEvent {
  id: string
  sessionId: string
  sequence: number
  type: 'user' | 'assistant' | 'tool' | 'system'
  createdAt: number
  payload: unknown
}

interface ContextCheckpoint {
  id: string
  sessionId: string
  throughSequence: number
  summary: string
  focus?: string
  createdAt: number
}
```

每个会话目录包含 `meta.json`、`events.jsonl`、`checkpoints/<id>.json`。写事件采用单 writer 队列；checkpoint 采用临时文件加 rename，成功后再原子更新 meta。读取时忽略 JSONL 尾部不完整行并记录恢复日志。保留 30 天且全局不超过 200MB，当前会话不参与淘汰。

## 4. IPC 契约

| 域 | API | 输入/输出 |
|---|---|---|
| file | `readText(path)` | 返回 `TextDocumentSnapshot`，拒绝二进制/非文本 |
| file | `saveText(request)` | 内容、编码、换行、expectedVersion；返回新版本 |
| file | `onOpenExternal(listener)` | Main 推送规范化绝对路径；返回 unsubscribe |
| file | `saveAttachment(request)` | 文档路径、mime、bytes/临时文件；返回相对路径 |
| recent | `list/add/remove` | `RecentItem[]`，Main 持久化 |
| review | `load/save/delete` | `ReviewSidecar` 与 expected sidecar version |
| review | `export(request)` | 格式、呈现、范围；返回保存路径或取消 |
| backup | `create/list/read/discard/saveAs` | 只允许预览、丢弃、另存 |
| session | `create/list/load/append/checkpoint/compact/delete` | 私有会话与压缩结果 |
| workspace | `scan/cancel` | taskId、分批条目、完成/失败事件 |
| log | `index/cancel/readPage` | taskId、索引版本、分页行 |

所有 handler 校验路径为绝对路径、枚举值合法、字符串和字节长度在上限内。Main 错误映射为稳定 `FluxErrorCode`，Renderer 不依赖 Node 错误文本。

## 5. 关键流程设计

### 5.1 启动、最近项与文件关联

1. Main 最早识别发行形态并设置数据根，然后创建 store、日志和服务。
2. 注册 IPC 后立即创建窗口；Skill 目录扫描改为窗口显示后的异步初始化。
3. Windows 安装版通过 builder `fileAssociations` 注册 `.md`，`.txt` 在安装器中显式可选；Portable 不注册。
4. 首次 argv 与 `second-instance` commandLine 统一交给 `extractOpenFilePath`，只接受存在的 MD/TXT/LOG 绝对路径。
5. 窗口未 ready 时进入单元素待处理队列；ready 后推送，Renderer 调用统一 `openFile` 并记录 recent。

保持 `appId: com.flux.text-editor` 和现有产品身份，确保 V1 覆盖升级。配置迁移失败时备份旧配置并以默认新增字段启动，不删除 Provider 信息。

### 5.2 文本读取和原子保存

读取先检查 NUL 比例和 MIME/扩展名，再检测 BOM、UTF-8、GBK，明确区分 UTF-16LE/BE。保存先按原编码编码；若目标编码无法表示新字符，返回 `ENCODING_UNREPRESENTABLE`，由 UI 选择转 UTF-8 或取消。

原子保存顺序：核对 expectedVersion；同目录写临时文件并 fsync；保留权限；rename 替换；重新读取 stat/hash；更新 Renderer snapshot。Windows rename 被占用时有限重试，失败保留临时文件诊断信息但不碰原文件。

大文件采样和 LOG 只读状态不允许调用保存或备份。

### 5.3 Markdown 模式

统一正文真相源是 `OpenDocumentState.draft`。源码和 MDX 编辑器的变更都只更新该 draft；阅读视图只消费 draft。模式切换不得触发磁盘写入。

MDXEditor 上线门槛：任务列表、表格、代码块、链接、图片和未知语法 fixture 连续执行“源码 -> MDX -> 源码”后语义无损。未通过则“编辑”模式保持 CodeMirror，产品仍提供高质量阅读与分栏，不阻塞其他 P0。

### 5.4 批注与 AI 评审

用户添加批注时，Renderer 从当前 draft 生成 anchor；Main 保存前再次校验 sourcePath 和 schema。正文编辑后在内存中重锚，只有保存批注或正文时才更新侧车 sourceHash。

AI 评审请求返回严格 JSON：

```ts
interface AiReviewFinding {
  id: string
  category: 'logic' | 'ambiguity' | 'format' | 'language'
  severity: 'info' | 'warning' | 'error'
  quote: string
  start?: number
  end?: number
  comment: string
  suggestion?: string
}
```

Renderer 校验范围和 quote，无法定位的 finding 可显示但不能直接接受为批注。所有 finding 先保存在会话内 pending 状态；用户逐条或全部接受后转换为 `ReviewComment(author='ai')` 并一次原子保存。Provider 非法 JSON、取消、超时均不落侧车。

### 5.5 选区 AI

预设动作由固定 action id 映射到版本化 Prompt，不允许 UI 传任意系统提示。请求包含文件版本、字符范围和选中文本 hash。只读动作返回文本；改写动作返回 replacement 和原范围。接受时检查当前 draft 对应范围 hash，冲突则要求重新运行。每次接受写入编辑器撤销栈，不直接保存磁盘。

### 5.6 `/compact` 与自动压缩

`ChatInput` 对规范化后的 `/compact` 或 `/compact <focus>` 本地拦截，不发送给 Provider。压缩器输入为活动 checkpoint 之后的增量事件、旧摘要和可选 focus；输出新 checkpoint。

事务顺序：锁定该 session 的 compact；生成摘要；写 checkpoint；更新 meta；Renderer 切换活动摘要并标记 throughSequence。任一步失败都保留旧 checkpoint 和消息。自动压缩复用同一命令，仅触发阈值不同；阈值按 Provider 的上下文窗口换算，未知模型使用保守默认值。

旧 `.flux/session-summary.md` 只在首次打开工作区时读取一次，转换为 legacy checkpoint 后在私有 meta 标记 migrated；不删除旧文件。后续不再写工作区 `.flux`。

### 5.7 图片附件

编辑器 paste/drop 先于全局 FileImporter 处理图片。默认附件目录为 Markdown 文件同目录下 `<文档名>.assets`。无文件路径的新文档先要求保存正文。文件名由时间戳加短 hash 构成并保留安全扩展名；Main 只接受 PNG/JPEG/GIF/WebP，限制单张 20MB。

Main 原子写入成功后返回 POSIX 风格相对路径，Renderer 才插入 `![alt](relative/path)`。失败不改正文。目录移动后因相对路径仍可渲染。

### 5.8 自动备份与恢复

Renderer 对 dirty 且非 sampled 的活动文档启动 60 秒 debounce；内容 hash 与最近快照相同则跳过。切换文档时各文档保留自己的计时状态，关闭应用前对 dirty 文档做一次 best-effort 快照。

Main 启动后扫描 manifest，只有快照时间晚于磁盘版本且 draftHash 不同才返回恢复候选。恢复 UI 只读预览并支持另存或丢弃。手工保存成功后不立即删除历史快照，由配额策略清理。

### 5.9 大目录和大日志

工作区扫描放入 worker thread 或独立异步迭代器，按每批不超过 200 项推送；taskId 使取消和过期结果可识别。默认忽略 `.git`、`node_modules`、隐藏目录、`.review.json` 和私有数据目录。文件树增量合并，不反复重建全树。

LOG 索引记录字节 offset、行号和级别统计，索引 key 为 path+size+mtime。分页读取从最近 offset 开始，不能每次重扫全文件。文件增长只追加索引；截断或 mtime 回退则重建。超过 2MB 的 `.log` 强制路由 `LogViewer`。

## 6. 发行路径与迁移

```text
安装版: <app.getPath('userData')>/
  config/  cache/  backup-cache/  sessions/  logs/  skills/

Portable: <exeDir>/data/
  config/  cache/  backup-cache/  sessions/  logs/  skills/
```

Portable 由 electron-builder `portable` target 注入环境标识或 portable executable dir 判断，禁止通过“目录可写”猜测发行形态。安装版不得优先写 exe 旁配置。首次安装版启动可从旧 `<exe>/config` 读取一次并复制到 userData；复制成功前不删除源配置。回退 baseline1.x 时旧配置仍可使用，baseline2.0 新字段由默认值忽略。

## 7. 性能与生命周期约束

- 首窗创建不能等待 Skill 扫描、recent 路径校验、备份清理或会话清理。
- ChatPanel 隐藏采用视觉折叠或把流订阅提升到常驻层，禁止因隐藏调用 `agent.cancel()`。
- 每个异步任务都有 taskId、AbortSignal 或显式 cancel IPC；组件卸载后不应用过期结果。
- JSONL、review、backup manifest、配置迁移都采用单 writer 或互斥锁，避免并发覆盖。
- 日志不记录 API key、完整文档正文、选区原文或会话 payload；只记录 hash、大小、耗时、错误码。

## 8. 实现顺序

1. 公共类型、发行数据根、配置 schema 与统一文本保存契约。
2. 多文档状态、recent、外部打开、默认布局和设置。
3. Markdown/TXT/LOG 路由、编码往返、异步目录与日志索引。
4. review 侧车、批注 UI 与导出。
5. 选区 AI、结构化评审。
6. session 持久化、`/compact`、迁移与清理。
7. 图片附件、自动备份恢复、安装/Portable 产物。

这一次序优先稳定数据和写入边界；后续 UI 任务只能消费已确认契约，不得自行另建持久化路径。

## 9. 验证计划

| 层级 | 重点 |
|---|---|
| 单元 | 编码/BOM/换行往返、路径归一化、review 重锚、导出转义、配额淘汰、checkpoint 回退 |
| 集成 | save conflict、侧车并发、附件原子性、session 尾部损坏恢复、workspace/log 取消 |
| Renderer | MRU 多文档、面板隐藏生命周期、选区 AI 接受/拒绝、批注双向定位 |
| 构建 | typecheck、Vitest、electron-vite build |
| 产物 | NSIS 升级/关联/卸载，Portable 数据隔离和 Unicode 路径 smoke |
| UI | 1440x900、1280x720、960x640 深浅主题截图与无重叠检查 |
| 性能 | 首窗关键路径、10k/100k 目录、100MB/1GB LOG、取消延迟、峰值内存 |

## 10. 回退策略与风险

- 数据 schema 均带版本；未知高版本只读，不降级覆盖。
- 新 WYSIWYG 未通过无损门槛时回退 CodeMirror 编辑，不影响阅读/分栏。
- 异步目录或日志索引异常时回退有限采样与明确只读提示，不阻塞主界面。
- AI 结构化解析失败时只显示原始回答，不生成批注或改写。
- session 新存储失败时当前会话仍在内存可用，但不回退写工作区 `.flux`。
- CRITICAL 变更集中在路径、编辑状态和编码保存；每个开发任务实施前必须重新运行 GitNexus 上游影响分析并向用户报告爆炸半径。

未决问题：0。接口契约属于同一 Electron 仓库内的跨层共享类型，不单独创建协议文档。
