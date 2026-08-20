# baseline2.2 自动化测试报告

## 结果

- TypeScript：`npx tsc --noEmit` 通过。
- ESLint：`npm run lint` 通过，0 error；剩余 warning 为既有非阻断项。
- Vitest：46 个测试文件、231 项测试通过。
- `git diff --check`：无空白错误。
- GitNexus：当前工作树重新索引成功，5,033 nodes / 8,874 edges / 298 flows。
- Electron dev：主进程、preload、renderer 构建并启动成功，开发地址 `http://localhost:5173/`。
- 打包：未执行，遵循“人工验证前不要打包”。
- 独立复审：两轮；最终结论无剩余 P0/P1。

## 新增覆盖

- 未保存保护的取消、不保存、保存和后台脏 session 枚举。
- 文件切换取消与丢弃后 session 恢复。
- WYSIWYG 批注对链接 URL、格式文本的序列化锚点映射。
- 重名标题 occurrence、格式标题和 Setext 标题解析。
- 文档放弃修改后的磁盘快照恢复与编辑器水合。
