# baseline2.0 团队 AI Markdown 编辑器影响面分析

> 状态：已闭合
> 基线提交：`d4761fd1554162dae77c125b1b020146c8019477`
> 输入：`docs/requirements/baseline2.0-team-ai-markdown-req.md`
> 分析日期：2026-08-06

## 1. 结论

本次迭代覆盖 Windows 桌面应用的 Main、Preload、Renderer、安装发布、用户数据持久化与自动化测试。16 个需求均已找到现有入口、断点和目标链路；编码相关阻塞项为 0，全部进入详细设计。

影响分析将 REQ-002、REQ-003、REQ-009、REQ-012、REQ-013、REQ-015、REQ-017 上调为“大”。原因不是扩大产品边界，而是这些需求均跨越至少三个运行层，且与文件完整性、升级兼容或长任务响应性耦合。

## 2. 需求分级与流转

| 需求 | 影响级别 | UI | 详细设计 | 主要落点 |
|---|---|---|---|---|
| REQ-001 轻量默认工作区 | 大 | 是 | 是 | AppShell、layoutStore、ChatPanel 生命周期 |
| REQ-002 快速启动与最近文件 | 大 | 是 | 是 | 启动顺序、electron-store、空状态首页 |
| REQ-003 Windows 覆盖升级与关联 | 大 | 是 | 是 | builder、argv、单实例、打开文件事件 |
| REQ-004 Markdown 编辑体验 | 大 | 是 | 是 | MarkdownEditor、MDXEditor、保存契约 |
| REQ-005 批注侧车 | 大 | 是 | 是 | 选区锚点、review IPC、原子侧车文件 |
| REQ-006 批注模式 | 大 | 是 | 是 | 编辑器装饰、批注侧栏、双向定位 |
| REQ-007 带批注导出 | 中 | 是 | 是 | Markdown/HTML 构建与原子导出 |
| REQ-008 AI 自动评审 | 大 | 是 | 是 | 结构化评审、预览确认、批注落盘 |
| REQ-009 选区 AI 快捷动作 | 大 | 是 | 是 | 选区工具条、动作结果、撤销/冲突 |
| REQ-011 MD/TXT/LOG 支持 | 大 | 是 | 是 | 编码往返、模式路由、大日志 |
| REQ-012 Markdown 图片附件 | 大 | 是 | 是 | 粘贴/拖放、附件 IPC、相对路径 |
| REQ-013 多文件与阅读偏好 | 大 | 是 | 是 | MRU、文档状态、字体字号持久化 |
| REQ-015 Portable | 大 | 否 | 是 | 发行形态、数据根、发布产物 |
| REQ-016 自动备份与恢复 | 大 | 是 | 是 | 快照、配额、恢复、保存冲突 |
| REQ-017 大目录/大文件性能 | 大 | 是 | 是 | 异步扫描、取消、日志索引、虚拟列表 |
| REQ-018 AI 上下文管理 | 大 | 是 | 是 | session、JSONL、checkpoint、/compact |

## 3. 端到端影响链

### 3.1 启动、布局与外部打开

`electron-builder/Windows Shell -> process.argv 或 second-instance -> Main 待处理路径队列 -> preload 事件 -> fileStore.openFile -> EditorRouter`

- `src/main/index.ts` 已有单实例锁，但首次启动和第二实例都未转发文件路径。
- `electron-builder.yml` 未注册 `.md/.txt`，当前 `zip` 也不等同于独立 Portable 发行形态。
- `AppShell.tsx` 始终挂载三栏；隐藏 AI 时若直接卸载 `ChatPanel` 会取消正在进行的流式请求。
- `registerAllHandlers` 在窗口创建前同步初始化 Skill，慢磁盘会推迟首屏。
- 空状态 `DropZone` 无最近文件和首次引导，主配置也没有 schema 版本及 recent 项。

### 3.2 文本读取、编辑与保存

`打开入口 -> file handlers -> 编码检测/读取 -> fileStore/editorStore -> EditorRouter -> 编辑器 -> 保存 IPC -> 原子写回`

- 读取已识别部分 GBK/UTF-16，人工保存和 AI 写回却固定 UTF-8，存在原编码破坏风险。
- UTF-16BE 与二进制拒绝不完整；`.log` 仍路由到普通编辑器，已有 `LogViewer` 没有实际入口。
- Markdown 的 `wysiwyg` 当前实际是只读预览，已存在但孤立的 `MdWysiwygEditor` 尚未接入。
- `editorStore` 是单文档状态；MRU 切换、每文档脏状态和光标恢复必须统一设计。
- 手工保存直接覆盖，无基线 hash/mtime 与外部修改冲突检测；可复用 AI 编辑链的快照和原子写入思路。

### 3.3 批注与导出

`编辑器选区 -> 稳定锚点 -> review store -> preload IPC -> review service -> <file>.review.json -> 编辑器高亮/侧栏 -> Markdown/HTML 导出`

- 当前选区只有文本和行号，不能抵抗原文变化。锚点需包含字符范围、原文 hash、上下文指纹和失效状态。
- 工作区扫描必须排除 `.review.json`，避免侧车文件出现在普通文件树。
- 源码、分栏和预览缺少统一范围映射，首版批注锚定以源码字符范围为真相源。
- 现有导出仅支持聊天 Markdown；批注导出需独立构建器、HTML 转义和原子写入。

### 3.4 AI 快捷动作、评审与上下文

`选区/文档命令 -> renderer 请求 -> agent IPC -> context assembler/provider -> 结构化结果 -> 用户接受/拒绝 -> 编辑或批注`

- 现有 AI 编辑具备预览、hash 冲突和原子写回基础，但只有行级范围，缺选区动作和撤销闭环。
- AI 评审没有结构化 schema、逐条接受/忽略状态和批注转换协议。
- 自动压缩当前先改内存状态再持久化，失败时可能切到不可恢复摘要；压缩游标只写不读。
- 会话仍写入工作区 `.flux/session-summary.md`，没有 sessionId、JSONL、原子检查点、配额清理或安装版/Portable 隔离。

### 3.5 附件、备份与运行时路径

`图片粘贴/拖放 -> 主进程附件写入 -> 相对路径插入 -> 本地协议预览`

`脏内容 -> 定时去重快照 -> 发行形态数据根 -> 原子写入/配额清理 -> 异常恢复`

- 全局拖放当前会把图片当作待打开文件；编辑器需先消费图片事件。
- `getWorkRoot/getConfigDir` 同时影响 Provider、Skill、Agent、日志和配置。安装版与 Portable 必须通过明确发行形态选择不同数据根。
- 大文件采样内容不得进入备份；恢复默认只允许预览或另存，不能静默覆盖原文件。

### 3.6 大目录与大日志

`打开目录 -> 可取消异步枚举 -> 增量树 -> Renderer`

`打开大日志 -> 后台索引 -> 分页读取 -> LogViewer 虚拟列表`

- 当前工作区同步递归扫描最多 4000 项并一次构树，无法取消。
- 日志索引在主进程同步扫全文件；区间读取每次近似从头扫到尾，随机滚动成本接近 O(文件大小)。
- 性能工作必须避免阻塞 Electron 主线程，并对快速切换、文件增长和任务取消做生命周期清理。

## 4. 高风险符号与处置

| 风险 | 符号/区域 | 处置 |
|---|---|---|
| CRITICAL | `getWorkRoot`、`getConfigDir` | 先定义发行形态与数据根，迁移后再接入备份/会话 |
| CRITICAL | `useEditorStore`、`useFileStore` | 先建立每文档状态和保存契约，再接 UI 功能 |
| CRITICAL | `detectEncoding`、文件写回 | 用同一编码元数据贯穿人工与 AI 保存，并做往返测试 |
| CRITICAL | `SkillManager.init` | 懒初始化或移出首屏关键路径，保留未就绪状态 |
| HIGH | `AppShell`、`ChatPanel` | AI 面板保持挂载并视觉折叠，避免中断流 |
| HIGH | `EditorPane`、选区链 | 统一字符范围，显式处理锚点失效和重叠 |
| HIGH | `buildLogIndex/readFileLineRange` | 后台任务、可取消索引、缓存失效协议 |

## 5. 验证边界

- 单元：编码往返、review schema/重锚、导出 golden、备份配额、上下文 checkpoint 与清理。
- 集成：Main/Preload/Renderer IPC 契约、外部打开、附件失败回滚、保存冲突、AI 结构化结果。
- UI：极简布局、最近文件、批注双向定位、选区工具条、设置与恢复入口。
- 产物：NSIS 覆盖升级、文件关联安装/卸载、Portable 数据隔离与真实产物 smoke test。
- 性能：1k/10k/100k 目录，100MB/1GB 日志，取消、切换和内存峰值。

## 6. 流转

阻塞项：0。全部需求进入 `ui-designer` 与 `design-writer`；实现阶段必须在修改高风险符号前再次执行 GitNexus 上游影响分析。
