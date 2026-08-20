# baseline2.3 自动化测试报告

## 当前结果

- TypeScript：`npx tsc --noEmit` 通过。
- ESLint：0 error；12 条既有 warning，未新增 warning。
- Vitest：48 个测试文件、239 项测试通过；竞态与安全修复后的定向测试 14 项通过。
- `git diff --check`：无空白错误，仅有仓库既有 CRLF 提示。
- Electron dev：main、preload、renderer 构建成功，窗口正常创建；未发现启动错误。
- 独立复审：两位 reviewer 最终确认无剩余 P0/P1。
- 打包：未执行，遵循人工验证完成前不打包。

## 新增覆盖

- 旧批注侧车缺少 `replies` 时继续读取。
- 修改人回复的规范化序列化。
- OpenAI/Anthropic 模型列表响应去重、排序与异常数据过滤。
- 模型列表分页元数据与工作区极简模式恢复。
- 回复保存与文档重载并发保护。
- 批注回复进入 Markdown/HTML 导出。

## 人工验证

见 `docs/testing/baseline2.3-collaboration-settings-manual-checklist.md`。
