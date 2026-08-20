# baseline2.1 编辑交互代码审查

> 结论：有条件通过
> 审查方式：独立 code-reviewer + 主流程集成复核

## Findings

未发现 Critical、Important 或可可靠定位的普通功能缺陷。

## 集成阶段已修复

| 问题 | 处理 |
|------|------|
| Markdown 源码缩放被两个 document 监听器重复处理 | Markdown 模式只保留全局快捷键入口 |
| 实时编辑正文偏好与外层 zoom 同时缩放 | 正文恢复 14px 基准，仅由外层比例缩放全部 Markdown 元素 |
| 表格控件使用不存在的主题变量 | 替换为 Flux 已有边框、卡片背景和阴影值 |
| AI 引用只写 Store、不展开聊天栏 | 增加幂等 `showChat()` 并在两种编辑模式调用 |

## 残余风险

- Milkdown 表格控制柄、窗口边缘菜单定位和高缩放布局需要真实 Electron 人工验收。
- 实时编辑批注只在选中文本可唯一映射到 Markdown 原文时启用；这是防止错误锚点的保守策略。
- 全工作树包含 baseline2.0 的大量未提交变更，GitNexus 聚合风险为 critical；本轮目标符号的修改前影响均为 LOW。
