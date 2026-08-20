# bugfix-round 2026-08-18 开发计划

## 背景

用户报告 5 个问题，走 dev-builder 流程逐任务独立 implementer 修复。基线：工作区已有大量未提交累积变更（baseline2.0~2.3 + 前几轮图标/编辑器修复），不得回退。

## 任务状态

- [x] TASK-BF-001 字号调大一号（批注栏文本、预览文件名、百分比）
- [x] TASK-BF-002 批注面板右上角按钮蓝底白字 + 调大
- [x] TASK-BF-003 mermaid 点击图/源码区外自动收起源码
- [x] TASK-BF-004 大纲及批注跳转无效——实证根因 + 修复
- [x] TASK-BF-005 编辑面列表后 `> ` 引用块渲染

## 执行记录

### TASK-BF-001（字号）
- 状态：已完成
- implementer：DONE，theme.css:2410-2429 + MarkdownEditor.tsx:126/174，tsc+244 测试通过
- 范围：
  - `src/renderer/src/styles/theme.css`：`.review-quote` 12px→13px、`.review-item p` 13px→14px、`.review-author-label`/`.review-meta`/`.review-reply>span` 11px→12px
  - `src/renderer/src/components/editor/MarkdownEditor.tsx`：工具栏文件名 `fontSize: 12`→13、缩放百分比 `fontSize: 12`→13

### TASK-BF-002（面板右上按钮）
- 状态：已完成
- implementer：DONE，theme.css:2400-2403 拆分选择器，header 按钮 32px 蓝底白字，review-actions 未动
- 范围：`src/renderer/src/styles/theme.css` `.review-panel>header button,.review-actions button`：28x28 → 32x32（或 30x30），蓝底（var(--accent)）白图标，hover 加深；disabled（AI 审阅）降透明度但保持同风格

### TASK-BF-003（mermaid 收起）
- 状态：已完成
- implementer：DONE，mermaidCodeBlockView.ts:49-54/88/162 新增 onDocMouseDown 监听与移除，tsc+244 测试通过
- 范围：`src/renderer/src/components/editor/mermaidCodeBlockView.ts`：document mousedown 监听，点击目标不在 this.dom 内时 hideSource()

### TASK-BF-004（跳转无效）
- 状态：已完成
- 修复：批注定位 stripInlineMarkdown 扁平文本+下标映射回退；大纲 headingTextFromNode 拼装（含图片 alt）+plainHeadingText 对称比较；parseMarkdownOutline 跳过 frontmatter；ReviewPanel 大文档不强制切 wysiwyg；失配 console.warn。新增 frontmatter 大纲测试 2 个，248 测试全绿
- 诊断结论：批注 quote 为 markdown 源码切片（含行内标记/跨行）在纯文本 doc 中 indexOf 失败；大纲转义标记/图片 alt/frontmatter 幻影条目失配；滚动与 effect 链路排除
- 范围：实证根因后最小修复。候选根因清单（implementer 需逐一验证）：
  1. Milkdown `create().then` 中 `ctx.get(editorViewCtx)` 是否返回 view（viewRef/viewReady 链路）
  2. 大纲 effect 匹配（level/textContent/occurrence）与滚动容器（.flux-scroll）是否正确
  3. 批注 quote 含 markdown 标记时 `findTextPositionInProseMirror` 匹配失败
  4. 源码模式 EditorPane `EV.scrollIntoView` 的滚动容器
  5. 用户环境可能运行旧包（需区分）
- 要求：写 vitest 定向测试复现链路；必要时临时诊断日志跑 dev 验证

### TASK-BF-005（编辑面列表后引用）
- 状态：待执行
- 范围：实证 WYSIWYG（Milkdown）中列表后 `> ` 的解析/输入行为；修复方向候选：defaultValue 预处理（与预览面 separateBlockquoteAfterList 相同逻辑）；输入时行为若属 Milkdown inputrule 限制需评估最小改动

## 验证清单

- [ ] tsc --noEmit 通过
- [ ] vitest 全量通过 + 每任务定向测试
- [ ] eslint 0 error

### TASK-BF-006（frontmatter 引用样式）
- 状态：已完成
- implementer：DONE_WITH_CONCERNS（concerns 可接受），markdownPreviewRenderer.ts:86-138 + theme.css:796-805 + mdPreview.test.tsx 新增 2 测试
- 范围：markdownPreviewRenderer.ts frontmatter 渲染（title/name→标题，description→引用块，其余→meta 行）+ theme.css 样式

### TASK-BF-007（帮助/skill 字号隔离）
- 状态：已完成
- implementer：同 BF-006，HelpView.tsx:97 + theme.css:917-923
- 范围：HelpView 预览容器加类名 + theme.css 恢复帮助/skill 预览 14px

### TASK-BF-008（mermaid ignoreMutation Critical）
- 状态：已完成
- implementer：DONE，mermaidCodeBlockView.ts:111-191 ignoreMutation 交还回读 + 语言守卫 + 补渲染防竞态，tsc+244 测试通过
- 范围：mermaidCodeBlockView.ts ignoreMutation contentDOM 交还回读 + update 语言守卫 + 渲染竞态补渲染
