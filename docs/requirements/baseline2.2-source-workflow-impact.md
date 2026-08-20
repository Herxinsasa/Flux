# baseline2.2 影响分析

## 影响结论

| 链路 | 主要符号/模块 | 上游入口 | 风险 |
| --- | --- | --- | --- |
| 源码输入 | `EditorPane`、`useEditor`、`editorStore` | `MarkdownEditor`、`EditorRouter` | 中 |
| 命令执行 | `MarkdownContextMenu`、`MenuBar`、两类 command adapter | 标题栏菜单、编辑/源码右键 | 中 |
| 编辑批注 | `MdWysiwygEditor`、`reviewStore` | Milkdown 选区、批注侧栏 | 中 |
| 大纲定位 | `MarkdownEditor`、`MdWysiwygEditor`、`MdOutlinePanel` | Markdown 工具栏 | 中 |
| 文件切换 | `fileStore`、导航保护器 | 标签、工作区、最近文件、链接、快捷键、系统打开 | 高 |
| 窗口关闭 | `main/index`、preload、`AppShell` | Electron 窗口关闭、应用退出 | 高 |
| 恢复预览 | `RecoveryBar`、`MdPreview` | 备份恢复入口 | 低 |
| 设置剪枝 | `SettingsView` | 设置页 | 低 |

## 约束与风险控制

- 文件切换保护必须位于公共切换入口之前，不能只在单个按钮上加判断。
- 主进程关闭拦截必须有一次性放行标志，避免确认后的再次 `close` 进入循环。
- 保存使用现有 `saveActiveDocument` 和版本冲突保护；保存失败不继续切换或退出。
- CodeMirror 保持内部事务和视口虚拟化；React 只在文档水合时下发完整 `value`，普通输入不再全文受控回灌。
- Milkdown 批注锚点通过临时边界标记序列化回 Markdown 偏移，避免用“纯文本必须唯一”限制正常格式化选区。
- 双模式命令共享静态菜单定义，防止顶部菜单与右键菜单再次漂移。

## 回归面

- Markdown 保存、外部版本冲突、自动备份。
- 标签关闭、Ctrl+Tab、工作区文件点击、Markdown 链接跳转。
- AI 改写后编辑器水合和选区恢复。
- 批注创建、侧车保存、批注高亮和重锚定。
- 主窗口正常关闭、取消关闭、保存后关闭。

