# baseline2.1 编辑交互需求设计

> 状态：已确认
> 界面契约：`docs/ui/baseline2.1-editor-interaction-ui.md`

## 设计决策

1. 删除 `SplitView`，编辑模式枚举收敛为 `wysiwyg | source`；模式切换只在两者间循环。
2. 新建共享 `MarkdownContextMenu`，只负责菜单结构、禁用状态、定位和可访问性；命令执行由编辑器适配器提供。
3. CodeMirror 适配器通过 `EditorView.dispatch` 操作选区或当前行；包装命令保持选择，块命令按完整行处理。
4. Milkdown 适配器通过 ProseMirror transaction、schema 和 GFM commands 操作结构，不从 DOM 反推文档。
5. 表格采用 Milkdown 官方 `tableBlock` NodeView，复用其行列选择、增删、拖动和对齐；Flux 只覆写视觉。
6. 内容缩放复用 `readingPreferences.bodyFontSize/codeFontSize`，工具栏显示换算比例；Ctrl 快捷键只在 Markdown 编辑器激活时生效。

## 共享命令契约

```ts
type MarkdownCommandId =
  | 'quote-ai' | 'comment'
  | 'bold' | 'italic' | 'inline-code' | 'blockquote'
  | 'ordered-list' | 'unordered-list' | 'task-list'
  | 'heading-1' | 'heading-2' | 'heading-3' | 'heading-4' | 'heading-5'
  | 'insert-link' | 'insert-image' | 'insert-table' | 'insert-code-block' | 'insert-divider'
```

菜单上下文至少包含：屏幕坐标、是否有选择、是否只读、AI 是否配置。命令返回后关闭菜单并恢复编辑器焦点。

## AI 与批注

- AI 引用复用 `chatStore.addQuote` 和现有聊天面板打开逻辑。
- 源码批注继续使用准确字符区间创建 `ReviewAnchor`。
- 实时编辑批注从 ProseMirror 选择取得文本，在当前 Markdown 中定位最接近且可验证的原文区间；无法可靠定位时禁用批注，不能写入错误锚点。

## 缩放与兼容

- 编辑模式使用正文偏好范围 12-24px；源码使用代码偏好范围 11-24px。
- 旧会话若出现 `split`，加载时按 `source` 处理，避免会话无法恢复。
- 不新增持久化字段，不改变主进程设置 schema。

## 验证

- 类型检查和生产构建（不打包）。
- 命令包装/块转换、菜单禁用、模式切换和缩放单元测试。
- Milkdown 表格手工验证：行列增删、选择、对齐、保存后重新打开。
- 现有 Markdown 预览覆盖测试全部回归。
