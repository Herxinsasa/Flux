# baseline2.2 技术设计

## 1. 源码编辑性能

CodeMirror 负责文档模型、视口渲染和输入事务。`EditorPane` 不再把 `editorStore.content` 作为逐键更新的受控 `value`；仅在 `editorHydrationEpoch` 变化时向 CodeMirror 同步完整文档。光标状态按帧合并，文档选区仅在选区真正变化时写入 session。移除 Markdown 源码选区 AI 浮层及其坐标计算。

## 2. 共享命令模型

从右键菜单抽取 `MARKDOWN_COMMAND_GROUPS`。顶部“段落”菜单按同一模型渲染，并通过 editor store 发布 `MarkdownCommandId`。源码适配器调用 `createSourceMarkdownEdit`，编辑适配器调用 `runWysiwygMarkdownCommand`。

## 3. 富文本批注锚点

Milkdown 选区两端插入仅用于序列化的唯一文本标记，然后通过 serializer 得到规范 Markdown 与偏移。移除标记后得到锚点正文，创建 `ReviewAnchor`。该事务不 dispatch，不改变用户文档。

## 4. 大纲定位

源码继续使用行号。编辑模式把大纲项及其同级同名出现序号传给 Milkdown；在 ProseMirror 文档中按 heading level、text 和 occurrence 查找节点位置，设置文本选择并滚动到视口。

## 5. 未保存状态机

renderer 提供单例异步导航保护器，返回 `save | discard | cancel`。所有公共文件切换入口在改变 `currentFile` 前等待保护结果。`AppShell` 挂载唯一的 `UnsavedChangesDialog` host，并复用 `saveActiveDocument`。

窗口关闭时主进程拦截第一次 `close` 并通知 renderer。renderer 完成同一保护流程后发送批准消息；主进程设置一次性放行标志并再次关闭。renderer 不可用时不静默覆盖正文，备份机制继续兜底。

