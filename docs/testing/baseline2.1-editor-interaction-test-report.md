# baseline2.1 编辑交互测试报告

> 状态：自动化验证通过，人工验收待执行
> 日期：2026-08-15

## 结果

| 验证 | 结果 | 说明 |
|------|------|------|
| 全量单元测试 | 通过 | 43 个文件，220/220 项通过 |
| 本轮菜单测试 | 通过 | 禁用状态、子菜单、源码转换覆盖 |
| 模式与缩放测试 | 通过 | implementer 定向 33/33 通过 |
| WYSIWYG 与表格测试 | 通过 | implementer 定向 10/10 通过 |
| 定向 ESLint | 通过 | 本轮生产文件 0 error |
| `git diff --check` | 通过 | 无空白错误 |
| 开发窗口日志 | 通过 | 新依赖优化和 HMR 后无新增 Vite 错误 |
| TypeScript 全工程 | 基线阻塞 | 仍有 10 个既有错误，本轮文件无新增错误 |
| 构建/打包 | 未执行 | 遵循用户要求，人工验证前不打包；为避免覆盖运行中的 `out` 也未执行 build |
| Electron 人工 UI | 待执行 | 使用 `baseline2.1-editor-interaction-manual-checklist.md` |

## 已知基线 TypeScript 错误范围

`ChatPanel.tsx`、`EditorPane.tsx` 既有 basicSetup 类型、`LogViewer.tsx`、`SearchPanel.tsx`、`AppShell.tsx`、`fileStore.ts` 和 web tsconfig 对 main schema 的引用。它们不是本轮新增，但后续应单独清理以恢复全工程类型门禁。
