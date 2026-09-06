# baseline2.0 Markdown 兼容性影响面

## 结论

影响面已闭合，整体风险为中。核心原因是预览使用 markdown-it，编辑使用 Milkdown/remark，两条解析链必须同步约束。

## 影响链

| 能力 | 主要位置 | 影响 |
|---|---|---|
| 预览解析 | `utils/markdownPreviewRenderer.ts` | 预览、帮助、AI 消息中的 Markdown |
| WYSIWYG 解析 | `components/editor/MdWysiwygEditor.tsx` | 编辑、粘贴、序列化和文件切换 |
| 标题锚点 | `utils/markdownHeadingIds.ts` | 大纲、内部链接、TOC、批注跳转 |
| Markdown 命令 | `markdownCommandModel.ts`、源码/WYSIWYG 命令 | 菜单和快捷入口 |
| 缩放 | `MarkdownEditor.tsx`、`MdWysiwygEditor.css` | 文本、图片、Mermaid、滚动区域 |
| 文档状态 | `editorStore.ts`、`fileStore.ts` | 加载、缓存、脏状态和外部更新 |

## GitNexus 结果

- `MdWysiwygEditorInner`：LOW，未发现直接上游调用符号。
- `MarkdownEditor`：LOW，未发现直接上游调用符号。
- `registerMarkdownHeadingIds`：LOW，1 个直接文件依赖、8 个三层内影响项。
- markdown-it 文件内函数未被图谱单独识别，使用静态调用检查和单元测试兜底。

## 风险控制

- 不修改现有标题 ID 算法，TOC 直接复用。
- 预览和编辑分别增加相同语法用例。
- 编辑器销毁和创建串行化，避免共享插件上下文竞态。
- 保留大文档源码模式阈值和文档缓存上限。

