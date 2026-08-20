# baseline2.3 影响分析

## 影响范围

- 批注：共享类型、侧车校验/序列化、renderer store、批注栏与导出呈现。
- 表格：Milkdown 表格 NodeView 的交互外观与命令调用。
- 布局：复用 `layoutStore.sidebarVisible`，影响顶栏与 AppShell 左栏宽度。
- 设置：renderer 表单、preload 类型、IPC channel 与主进程供应商请求。

## 风险

- 中：供应商 `/models` 返回格式和 URL 可能不一致，必须限制协议、超时与响应大小。
- 中：侧车结构扩展必须兼容旧文件，`replies` 采用可选字段并在写回时规范化。
- 低：工作区显示状态已有持久化实现，只补显式入口。
- 中：表格 UI 依赖 Milkdown NodeView DOM，需通过组件测试和人工操作验证。
