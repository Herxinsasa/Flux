# baseline2.0 Team AI Markdown Test Report

## 结论

**PASS（自动化验证通过，发布前仍需完成手工残余验证）**。

本报告由 DevFlow `code-tester` 独立执行。测试范围为 Windows x64、`baseline2.0` 分支当前工作树；未修改产品代码、测试断言或提交。自动化测试、生产构建、lint 和差异检查均通过。真实安装/升级/卸载、系统双击关联、真实 Provider 和视觉截图未执行，均列为手工残余风险，不以自动化结果替代。

## 环境与范围

| 项 | 值 |
|---|---|
| 工作区 | `F:\Dev\Vibe Coding\FluxV2` |
| 分支 | `baseline2.0` |
| HEAD | `d4761fd` (`feat: v1.0.2 上下文管理、大日志索引、钉住结论、报告导出优化`) |
| OS | Windows 11 专业版 10.0.22621，64 位 |
| Node / npm | Node `v24.14.0` / npm `11.12.0` |
| Vitest | `4.1.5`，win32-x64 |
| 依据 | requirements、design、ui、plan、TASK-009 release validation、最终 code review APPROVED |
| 代码修改 | 无 |
| 测试断言修改 | 无 |

## 全量命令证据

| 命令 | 结果 | 精确证据 |
|---|---|---|
| `npm.cmd test` | PASS | 37 个测试文件，194 个测试通过 |
| `npm.cmd run build` | PASS | Main 318 modules；Preload 3 modules；Renderer 2138 modules；三部分均构建成功 |
| `npm.cmd run lint` | PASS（非阻塞 warning） | 0 errors，17 warnings |
| `git diff --check` | PASS | 无空白错误；仅有 Windows 工作树 LF/CRLF 转换提示 |

### Lint warnings

17 个 warning 均为既有未使用参数、未使用变量或无效 eslint-disable 指令；没有 error，也没有因 warning 判失败。

| 文件 | 数量 | 位置/类型摘要 |
|---|---:|---|
| `src/main/ipc/agent-handlers.ts` | 1 | `context` 未使用 |
| `src/main/ipc/settings-handlers.ts` | 1 | `_hint` 未使用 |
| `src/main/services/file-service.ts` | 1 | `no-control-regex` 的 disable 指令无效 |
| `src/renderer/src/components/chat/ChatPanel.tsx` | 3 | `progressHint`、`latestAiHasVisibleText`、`latestAiHasVisibleTools` 未使用 |
| `src/renderer/src/components/common/UnsavedChangesDialog.tsx` | 1 | `useEditorStore` 未使用 |
| `src/renderer/src/components/layout/Sidebar.tsx` | 1 | `useSettingsStore` 未使用 |
| `src/renderer/src/components/settings/SettingsView.tsx` | 1 | `e` 未使用 |
| `src/renderer/src/components/skill/SkillPanel.tsx` | 2 | `react-hooks/exhaustive-deps` disable 指令无效 |
| `src/renderer/src/hooks/useEditorChatBridge.ts` | 1 | `setPreviewContent` 未使用 |
| `src/renderer/src/hooks/useProvider.ts` | 1 | `_err` 未使用 |
| `src/renderer/src/stores/chatStore.ts` | 1 | `get` 未使用 |
| `src/renderer/src/stores/editorStore.ts` | 1 | `_removed` 未使用 |
| `src/renderer/src/stores/fileStore.ts` | 2 | `root`、`replacePath` 未使用 |

## 高风险回归分组

各组使用 Vitest 直接指定测试文件，均为独立重跑；以下合计为分组断言数，不与全量 194 项相加作为总数。

| 分组 | 需求映射 | 测试文件数 | 通过数 | 结果 |
|---|---|---:|---:|---|
| 保存、编码、冲突、generation | REQ-003、REQ-011、REQ-016 | 5 | 38/38 | PASS |
| review 重锚、并发、导出 | REQ-005、REQ-006、REQ-007 | 4 | 15/15 | PASS |
| AI action stale、结构化解析、上下文 | REQ-008、REQ-009、REQ-018 | 5 | 21/21 | PASS |
| session JSONL、checkpoint、compact、隔离、active cleanup | REQ-001、REQ-018 | 6 | 45/45 | PASS |
| UTF-16LE/BE、context cache-only | REQ-011、REQ-017、REQ-018 | 3 | 29/29 | PASS |
| 图片附件、备份恢复 | REQ-012、REQ-016 | 2 | 6/6 | PASS |
| release config、Portable Unicode、外部打开 | REQ-003、REQ-015 | 4 | 15/15 | PASS |

## 需求追踪矩阵

| 需求 | 自动化证据 | 结论 | 未覆盖项 |
|---|---|---|---|
| REQ-001 轻量工作区 | `layoutStore`、`chatStore`、session 分组 | 自动化 PASS | 默认布局、隐藏/呼出面板的真实视觉与窗口启动需手工验证 |
| REQ-002 启动/最近/引导 | `launch-file.test.ts`、`recent.test.ts`、`schema.test.ts` | 自动化 PASS | 冷启动白屏时间和首次启动卡片需手工验证 |
| REQ-003 文件关联 | `release-config.test.ts`、`launch-file.test.ts`、发布配置检查 | 自动化/静态 PASS | 安装后注册表、已运行实例复用、卸载清理和真实双击未执行 |
| REQ-004 Markdown 阅读编辑 | `editorRouter.test.ts`、`markdown-path.test.ts`、构建 | 自动化 PASS | 深浅主题、三种模式切换、长文视觉和输入流畅度未截图/手工验证 |
| REQ-005 review 侧车模型 | `review-service.test.ts`、`review-save-generation.test.ts` | PASS | 真实只读目录和损坏文件交互未手工验证 |
| REQ-006 批注交互/模式 | review service、editor 与导出相关回归 | 自动化 PASS | 高亮、侧栏定位、重叠批注的真实视觉未验证 |
| REQ-007 批注导出 | `review-export.test.ts`、`reportExportBuild.test.ts` | PASS | 未在真实浏览器打开 HTML；未验证钉钉/飞书实际投递 |
| REQ-008 AI 自动评审 | `ai-action.test.ts`、`ai-action-store.test.ts`、review 回归 | 自动化 PASS | 未使用真实 Provider 执行请求、取消和超时 UI 冒烟 |
| REQ-009 选区 AI | AI action、stale、解析回归 | 自动化 PASS | 浮动工具条遮挡、键盘可达性和无 Provider 配置入口未手工验证 |
| REQ-011 MD/TXT/LOG | 编码保存、UTF-16、日志索引、路由测试 | 自动化 PASS | 真实超大文件响应性及非支持二进制提示未手工验证 |
| REQ-012 图片附件 | `attachment-service.test.ts`、构建 | PASS | 系统剪贴板和拖放真实交互未执行 |
| REQ-013 多文件/阅读偏好 | `document-session.test.ts`、`editorStore.test.ts`、settings/shortcut 回归 | PASS | 多窗口真实切换和字体视觉未验证 |
| REQ-015 Portable 发布 | `paths-release-mode.test.ts`、`release-config.test.ts`、产物检查 | PASS | Portable 在干净机器的启动和数据目录验证未执行 |
| REQ-016 自动备份/恢复 | `backup-service.test.ts`、保存 generation、附件回归 | PASS | 恢复条真实 UI 和崩溃恢复场景未手工验证 |
| REQ-017 大目录/大文件流畅性 | `workspace-service.test.ts`、`log-index-service.test.ts`、UTF-16 分组 | 自动化 PASS | 真实性能基准、窗口帧率和取消时的人工体验未验证 |
| REQ-018 对话上下文/`/compact` | session JSONL/checkpoint/compact/隔离/cleanup、context cache-only 回归 | 自动化 PASS | 真实 Provider、长时间运行和重启后的 Electron UI 尚未手工验证 |

## 发布产物验证

未安装、未执行任何未签名 EXE。

| 产物 | 存在 | 大小 | SHA256 | 签名 |
|---|---|---:|---|---|
| `release/Flux-2.0.0-beta.1-setup-x64.exe` | 是 | 122,504,086 bytes | `7ACFC5A534470E6E784A7A3AC8395DCFE9B5B09CB8B2049A087EB09B57453603` | `NotSigned` |
| `release/Flux-2.0.0-beta.1-portable-x64.exe` | 是 | 122,179,169 bytes | `7D1A3D3B5F7B02B3A4CEFE0E43E0765877ED8987B63B99A829467FB1B6D6D98E` | `NotSigned` |

静态配置核对结果：`package.json` 版本为 `2.0.0-beta.1`；`appId` 为 `com.flux.text-editor`；`productName` 为 `Flux`；Windows 目标仅 NSIS x64 和 portable x64；配置声明 `.md`、`.markdown`、`.txt`、`.log` 四类关联。Portable 不执行安装注册流程，真实关联行为仍需安装后手工确认。

## Git 状态

- 当前分支：`baseline2.0`。
- HEAD：`d4761fd`。
- 暂存区：空。
- 没有本轮新 commit；工作树保留本次迭代未提交变更。
- `release-isv.zip` 为工作区中既有的未跟踪发布辅助文件，本报告将其标记为 **preexisting excluded**，不纳入产品或测试判断。

## 残余风险与后续验证

1. **手工 Windows 安装验证未执行**：安装、baseline2.0 覆盖升级、卸载、注册表文件关联和已运行实例双击复用需在干净 Windows 环境完成。
2. **Portable 手工验证未执行**：需确认免安装启动、`data` 目录落点、无注册表副作用和升级数据保留。
3. **真实 Provider 未执行**：需验证真实凭据下选区 AI、AI 审阅、取消、超时、Provider 不可用提示及 `/compact` 前后体验。
4. **视觉/UI 未执行**：未生成深浅主题、最小模式、review 高亮、AI 工具条、恢复条和设置页面截图；不能把自动化测试视为视觉验收。
5. Electron 运行时依赖已修复并验证为 `v41.4.0`；开发模式真实启动已达到 `App ready`、`Main window created`、Renderer HTTP 200 和 SkillManager 初始化。窗口级视觉截图、长时间运行与真实交互仍按上述手工残余项执行。

## 最终判定

**PASS for automated baseline2.0 validation.** 代码 review 已最终 APPROVED，自动化回归无失败；发布前仍以完成上述手工残余验证为条件，不宣称已完成真实安装、真实 Provider 或视觉验收。
