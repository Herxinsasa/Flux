# baseline2.1 编辑交互优化影响面

> 状态：已闭合
> 需求规格：`docs/requirements/baseline2.1-editor-interaction-req.md`
> 证据：GitNexus 影响分析、源码扫描、Milkdown 本地类型与实现

## 结论

| 需求项 | 级别 | 链路 | 详细设计 | 关键影响 |
|--------|------|------|----------|----------|
| REQ-001 | 小 | 已闭合 | 是 | `editorStore` 模式枚举、快捷切换、`MarkdownEditor` |
| REQ-002 | 小 | 已闭合 | 否 | `MarkdownEditor` 布局顺序与跳转 |
| REQ-003 | 大 | 已闭合 | 是 | 共享菜单契约、CodeMirror/Milkdown 两个适配器、聊天与批注 Store |
| REQ-004 | 小 | 已闭合 | 否 | `theme.css` 视觉变量与固定尺寸 |
| REQ-005 | 中 | 已闭合 | 是 | 阅读偏好、编辑容器缩放与快捷键 |
| REQ-006 | 大 | 已闭合 | 是 | Milkdown GFM 表格 NodeView 与结构命令 |

## 端到端链路

| 顺序 | 边界 | 路径/符号 | 变化 |
|------|------|-----------|------|
| 1 | 模式入口 | `MarkdownEditor` | 移除分栏并增加缩放入口 |
| 2 | 模式状态 | `editorStore.markdownEditSurface` | 收敛为 `wysiwyg/source`，兼容旧值回落 |
| 3 | 右键入口 | `EditorPane`、`MdWysiwygEditorInner` | 生成统一菜单上下文 |
| 4 | 命令适配 | CodeMirror transaction / Milkdown command manager | 将统一命令映射到各自编辑器操作 |
| 5 | AI/批注 | `chatStore`、`reviewStore` | 复用既有引用和侧车批注链路 |
| 6 | 保存 | `editorStore.setContent` | 所有编辑命令继续触发既有自动保存链路 |

## GitNexus 风险

- `MarkdownEditor`：LOW，无上游符号。
- `MdWysiwygEditorInner`：LOW，无上游符号。
- `EditorPane`：LOW，直接影响 `EditorRouter`，间接影响 `AppShell`。
- `setMarkdownEditSurface`：LOW，仅直接影响模式切换函数。
- `applyReadingPreferences`：LOW；共享导入较多，因此只复用现有偏好，不改设置通信结构。

## 聚合风险与控制

| 风险 | 控制 |
|------|------|
| 两内核命令行为漂移 | 共享菜单模型，分别编写适配器及单元测试 |
| Milkdown 选择位置与 Markdown 字符偏移不同 | 批注锚点只在可确定原文范围时提交；选择文本按原文唯一/最近匹配定位 |
| 表格命令破坏 Markdown 序列化 | 使用 `@milkdown/components/table-block` 和 GFM 命令，不操作表格字符串 |
| 全局放大导致布局挤压 | 只提升一级并保持稳定按钮尺寸、溢出和换行约束 |

## 阻塞问题

无。
