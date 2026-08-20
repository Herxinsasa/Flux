# baseline2.0 团队 AI Markdown 编辑器开发计划

> 状态：执行中
> 基线提交：`d4761fd1554162dae77c125b1b020146c8019477`
> 迭代开始时已有变更：工作流、规范、需求与资产为未跟踪内容；不覆盖或自动提交

## 1. 输入与门禁

| 输入 | 路径 | 状态 |
|---|---|---|
| 需求规格 | `docs/requirements/baseline2.0-team-ai-markdown-req.md` | 已确认 |
| 影响面 | `docs/requirements/baseline2.0-team-ai-markdown-impact.md` | 已闭合 |
| 界面契约 | `docs/ui/baseline2.0-team-ai-markdown-ui.md` | 已确认 |
| 需求设计 | `docs/design/baseline2.0-team-ai-markdown-req-design.md` | 已确认 |

阻塞项：0。每个任务修改现有符号前单独执行 GitNexus upstream impact；HIGH/CRITICAL 先报告再派发 implementer。

## 2. 编码任务

| 任务 ID | 任务 | 需求 | 目标路径/对象 | 依赖 | 状态 | 验收标准 |
|---|---|---|---|---|---|---|
| TASK-001 | 稳定数据根、配置迁移与文本保存契约 | 003,011,015,016 | shared、paths、store、file services/IPC/preload | 无 | 已完成 | 安装/Portable 路径隔离；编码/换行往返；冲突不覆盖 |
| TASK-002 | 启动、外部打开、最近项与轻量布局 | 001,002,003 | main index、recent、AppShell、DropZone、layout | 001 | 已完成 | AI 默认隐藏；最近 10 项；首次/二次实例打开文件 |
| TASK-003 | 多文档、字体偏好与 Markdown/TXT/LOG 路由 | 004,011,013 | file/editor/settings stores、shortcuts、editors | 001 | 已完成 | MRU 切换保留草稿；字体持久化；LOG 进入专用视图 |
| TASK-004 | 可取消目录扫描与日志索引 | 017 | workspace/log services、IPC、FileTree、LogViewer | 003 | 已完成 | 增量结果、可取消、过期结果不生效；分页不全量重扫 |
| TASK-005 | review 侧车、批注模式与导出 | 005,006,007 | review schema/service/IPC/store/UI/export | 001,003 | 已完成 | 稳定锚点与失效态；原子侧车；MD/HTML 导出 |
| TASK-006 | 选区 AI 与结构化文档评审 | 008,009 | editor selection、AI action、review pending UI | 005 | 已完成 | 固定动作、版本冲突、接受/拒绝；确认后才写批注 |
| TASK-007 | 会话持久化与 `/compact` | 018 | session service/IPC/store、ChatInput/ChatPanel | 001 | 已完成 | JSONL/checkpoint 原子性；失败回退；迁移与配额清理 |
| TASK-008 | 图片附件与自动备份恢复 | 012,016 | attachment/backup services、IPC、editor/recovery UI | 001,003 | 已完成 | 相对图片路径；失败不插入；快照去重/配额/另存恢复 |
| TASK-009 | Windows 发布配置与自动化测试补齐 | 003,015,全部 | builder、tests、必要 fixture/scripts | 001-008 | 已完成 | NSIS/Portable 配置正确；核心单元/集成测试与 build 通过 |

## 3. 任务边界

### TASK-001 稳定数据与保存基础

| 项 | 内容 |
|---|---|
| 输入契约 | 设计 3.1、3.4、4、5.2、6 |
| 允许修改 | `src/shared/**`、`src/main/paths.ts`、`src/main/store/**`、`src/main/services/file-service.ts`、`src/main/ipc/file-handlers.ts`、`src/preload/index.ts`、`src/renderer/src/env.d.ts` 及对应测试 |
| 禁止修改 | Renderer 布局、批注和聊天 UI |
| 完成条件 | 统一 read/save DTO；原编码和换行保存；mtime/hash 冲突；明确安装/Portable 数据根与 schema 迁移 |

### TASK-002 启动与轻量工作区

| 项 | 内容 |
|---|---|
| 输入契约 | 设计 5.1；UI 3、4 |
| 允许修改 | `src/main/index.ts`、IPC 注册、recent service、preload 事件、`AppShell`、`DropZone`、`TitleBar`、`layoutStore`、启动相关测试 |
| 禁止修改 | ChatPanel 内部消息/压缩算法 |
| 完成条件 | 首屏不等待 Skill 扫描；AI 默认折叠且隐藏不中断流；recent 与引导可用；外部文件队列闭合 |

### TASK-003 文档状态与编辑器

| 项 | 内容 |
|---|---|
| 输入契约 | 设计 3.2、5.2、5.3；UI 3.2、5 |
| 允许修改 | file/editor/settings stores、shortcuts、EditorRouter、MarkdownEditor、EditorPane、LogViewer、SettingsView 与测试 |
| 禁止修改 | review/session 持久化 |
| 完成条件 | 每文档草稿和脏状态；MRU 正反切换；MD/TXT/LOG 正确路由；字号字体启动恢复；Markdown 模式不丢正文 |

### TASK-004 性能链路

| 项 | 内容 |
|---|---|
| 输入契约 | 设计 5.9、7；影响分析 3.6 |
| 允许修改 | workspace/log services 与 handlers、相关 preload API、文件树和 LogViewer、性能测试 |
| 禁止修改 | 普通文本保存、AI 与 review |
| 完成条件 | 扫描和索引不阻塞主线程；支持取消和 taskId；增量树；日志分页复用 offset |

### TASK-005 批注闭环

| 项 | 内容 |
|---|---|
| 输入契约 | 设计 3.3、4、5.4；UI 6 |
| 允许修改 | 新 review 模块、shared/preload 增量、选区高亮、EditorPane、AppShell 侧栏、export 模块与测试 |
| 禁止修改 | Provider 与 session 压缩 |
| 完成条件 | 添加/编辑/解决/删除/重锚；工作区隐藏侧车；原子保存；Markdown/HTML 安全导出 |

### TASK-006 AI 快捷动作与评审

| 项 | 内容 |
|---|---|
| 输入契约 | 设计 5.4、5.5；UI 7.1、7.2 |
| 允许修改 | AI action shared 类型、agent handler/assembler 增量、选区工具条、结果浮层、review pending UI 与测试 |
| 禁止修改 | Provider 凭据、session 磁盘格式 |
| 完成条件 | 预设动作固定；请求可取消；改写有冲突与撤销；评审结构校验；未确认不落盘 |

### TASK-007 会话与压缩

| 项 | 内容 |
|---|---|
| 输入契约 | 设计 3.6、5.6；UI 7.3 |
| 允许修改 | session service/handler/shared/preload、sessionContextStore、ChatInput、ChatPanel、context assembler 与测试 |
| 禁止修改 | review/backup 格式 |
| 完成条件 | sessionId 隔离；JSONL 尾损恢复；checkpoint 事务；`/compact` 本地截获；30 天/200MB；旧 `.flux` 一次迁移 |

### TASK-008 附件与备份

| 项 | 内容 |
|---|---|
| 输入契约 | 设计 3.5、5.7、5.8；UI 8 |
| 允许修改 | attachment/backup service/IPC/preload、FileImporter、Markdown 编辑器、backup scheduler/store/recovery UI 与测试 |
| 禁止修改 | 原文件自动覆盖、云存储 |
| 完成条件 | 图片原子写入后才插链接；60 秒快照去重；20 份/500MB/30 天；恢复仅预览/另存/丢弃 |

### TASK-009 发布与测试收口

| 项 | 内容 |
|---|---|
| 输入契约 | 需求全部验收标准、设计 9、UI 10 |
| 允许修改 | `electron-builder.yml`、测试/fixture/脚本、必要的小范围缺陷修正 |
| 禁止修改 | 新增计划外产品功能 |
| 完成条件 | build 与测试通过；builder 同时产出 NSIS/portable；关联只属于安装版；测试矩阵有可执行证据 |

## 4. 验证清单

| 验证 ID | 需求 | 类型 | 命令/步骤 | 期望 | 状态 |
|---|---|---|---|---|---|
| VERIFY-001 | 全部 | 静态/单元 | `npm test` | 全部通过 | 已通过：37 files / 194 tests |
| VERIFY-002 | 全部 | 构建 | `npm run build` | Main/Preload/Renderer 构建成功 | 已通过 |
| VERIFY-003 | 001-013,016-018 | UI | Electron 深浅主题和三种窗口截图 | 无重叠，状态齐全 | 手工残余：本机 Electron CLI 缺失，未完成截图 |
| VERIFY-004 | 003,015 | 发布 | 构建 NSIS 与 portable，检查配置 | 产物和关联配置正确 | 自动验证通过；真实安装/关联待手工验证 |
| VERIFY-005 | 011,016 | 数据完整性 | 编码 fixture、外部修改、备份恢复 | 原文件不被静默破坏 | 已通过自动化回归 |
| VERIFY-006 | 017 | 性能 | 目录/日志基准脚本 | 可取消、主线程可响应 | 已通过自动化回归；真实大文件体验待手工验证 |
| VERIFY-007 | 018 | 会话恢复 | 30 轮、尾损、重启、compact | 摘要不重复，失败不切换 | 已通过自动化回归；真实 Provider 待手工验证 |

## 5. 串并行与冲突

TASK-001 是全部写入能力的前置。TASK-002 与 TASK-003 在 shared/preload 和 stores 有交集，串行执行。TASK-004、TASK-005、TASK-007 可在 TASK-003 后使用不同写集并行，但为减少同一工作区合并风险按序派发。TASK-006 依赖 review，TASK-008 依赖统一保存与文档状态，TASK-009 最后收口。

## 6. 执行记录

| 时间 | 任务 ID | 状态变化 | Agent | Agent ID | 说明 |
|---|---|---|---|---|---|
| 2026-08-06 | PLAN | 初始化 -> 执行中 | dev-planner | current | 门禁已满足，9 个编码任务、7 个验证项 |
| 2026-08-06 | TASK-001 | 待执行 -> 执行中 | implementer | pending | GitNexus: getWorkRoot/detectEncoding/getFileInfo CRITICAL，readFileLineRange HIGH；保持旧调用兼容 |
| 2026-08-06 | TASK-001 | 执行中 -> 已完成 | implementer | 019fd2d9-f882-7541-b80f-a24403254276 | readText/saveText、发行数据根、Store v2 与 8 个编码/冲突测试；build 通过 |
| 2026-08-06 | TASK-002 | 待执行 -> 执行中 | implementer | pending | GitNexus: SkillManager.init/ensureInit CRITICAL，useChatStore HIGH；采用惰性初始化与常驻聊天生命周期 |
| 2026-08-06 | TASK-002 | 执行中 -> 已完成 | implementer | 019fd2e5-c681-7650-9a09-24c0ebc361c6 | 启动队列、recent、轻量布局、惰性 Skill 初始化；118 tests 与 build 通过 |
| 2026-08-06 | TASK-002 | 审查偏差 -> 已修复 | implementer | 019fd2f5-6011-7ba3-a1ad-278f043e58c2 | 引导持久化关闭、中文文案、合法最近项按钮结构；聚焦测试与 build 通过 |
| 2026-08-06 | TASK-003 | 待执行 -> 执行中 | implementer | pending | GitNexus: file/editor/settings stores CRITICAL，inferMode/EditorPane HIGH；增量兼容迁移 |
| 2026-08-06 | TASK-003 | 执行中 -> 已完成 | implementer | 019fd2ff-2df7-7770-8aef-a78af12f693b | 多文档会话/MRU、版本化保存、文本路由、字体偏好；后续修复 readText 阻断与脏文档关闭偏差；132 tests/build 通过 |
| 2026-08-06 | TASK-004 | 待执行 -> 执行中 | implementer | pending | GitNexus: getLogIndex HIGH；其余 workspace/log/UI 入口 LOW，保持兼容结果形状 |
| 2026-08-06 | TASK-004 | 执行中 -> 已完成 | implementer | 019fd31f-8366-7653-9db7-3ea306125bbf | 目录扫描分批/取消、日志异步索引/追加/截断重建；136 tests、build 与 diff check 通过 |
| 2026-08-06 | TASK-005 | 待执行 -> 执行中 | implementer | pending | GitNexus: MdPreview CRITICAL、ReportExport/useSelectionHighlight HIGH；不修改通用预览器，批注高亮收敛在源码编辑器 |
| 2026-08-06 | TASK-005 | 执行中 -> 已完成 | implementer | 019fd336-b13f-7c62-a806-b6a897717d27 | review 侧车、重锚/失效、批注侧栏和 MD/HTML 原子导出；145 tests、build 与 diff check 通过 |
| 2026-08-06 | TASK-006 | 待执行 -> 执行中 | implementer | pending | GitNexus: EditorPane/useSelectionHighlight/useChatStore HIGH；AI 结果先进入待确认态，禁止无确认写正文或侧车 |
| 2026-08-06 | TASK-006 | 执行中 -> 已完成 | implementer | 019fd780-b956-7d93-9a93-15d61e70d215 | 7 个选区动作、stale 校验、结构化 findings 和确认写批注；154 tests、build 与 diff check 通过 |
| 2026-08-06 | TASK-007 | 待执行 -> 执行中 | implementer | pending | GitNexus: ChatInput/useChatStore/useSessionContextStore HIGH；session handlers/service LOW，采用私有 sessionId 隔离与原子 checkpoint |
| 2026-08-06 | TASK-007 | 执行中 -> 已完成 | implementer | 019fd7a3-55af-7543-b2d1-9edb554cbc94 | 私有 JSONL、双 checkpoint、旧摘要迁移、/compact 与配额设置；160 tests、build 与 diff check 通过 |
| 2026-08-06 | TASK-008 | 待执行 -> 执行中 | implementer | pending | GitNexus: EditorPane HIGH，useEditorStore/useFileStore CRITICAL，SettingsView/AppShell LOW；新增主进程附件/备份边界 |
| 2026-08-06 | TASK-008 | 执行中 -> 已完成 | implementer | codex-inline-019ebc1e | 附件原子写、恢复快照与配额、IPC、Markdown 图片粘贴/拖放、60 秒独立快照调度和只读恢复条；29 files / 164 tests、build 与 diff check 通过 |
| 2026-08-06 | TASK-008 | 父级复验失败 -> 已修复 | implementer | 019fd7b2-4943-7f23-9fde-43ea3e46136e | 修复 Windows 同毫秒 mtime 导致恢复候选丢失；聚焦测试连续 10 次、166 tests 与 build 通过 |
| 2026-08-06 | TASK-009 | 待执行 -> 执行中 | implementer | pending | 保持 appId/productName 兼容升级，Windows 收敛为 NSIS + portable，补文件关联与发行验证 |
| 2026-08-07 | TASK-009 | 执行中 -> 已完成 | implementer | not-recorded | Windows NSIS/Portable、文件关联与发布回归完成；最终产物已在评审修复后重打包 |
| 2026-08-07 | CODE-REVIEW | 执行中 -> APPROVED | code-reviewer | 019fd7d7-a50e-7902-a00f-b0fe694cce6d | 三轮独立评审共 11 项发现全部关闭 |
| 2026-08-07 | TEST | 执行中 -> PASS | code-tester | 019fd811-16ad-7d12-b0ca-c24d7adf499a | 37 files / 194 tests；build、lint、diff check 与产物配置通过；保留手工发布验证项 |
