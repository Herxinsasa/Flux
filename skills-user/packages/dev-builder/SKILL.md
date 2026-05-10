---
name: dev-builder
description: 根据开发计划编写代码。按任务调度 implementer sub-agent，在 <project-name>/ 目录下创建项目。
---

# Dev Builder — 项目开发

## 职责

根据 `Dev-Plan.md` 中的任务清单，按任务调度独立的 `implementer` sub-agent 完成编码实现。在 `<project-name>/` 目录下创建完整项目。

## 触发场景

- Dev-Plan.md 已就绪，需要开始编码
- 用户说"开始开发"、"写代码"、"实现"

## 核心原则

1. **每个任务独立 sub-agent** — 使用 Agent 工具为每个任务创建新的 implementer 实例
2. **不继承上下文** — 每个 implementer 只接收当前任务的上下文
3. **两阶段审查** — 每个任务完成后先审查规格对齐，再审查代码质量
4. **简单优先** — 遵循 Karpathy 准则：最小代码解决问题

## 工作流程

### Step 1: 初始化项目
在 `<project-name>/` 目录下创建项目：
- 如果用户指定了技术栈，使用对应的脚手架工具
- 如果没有指定，询问用户偏好
- 初始化版本控制（如果需要）

### Step 2: 逐任务实现
遍历 `Dev-Plan.md` 中的任务，对每个任务：

1. **创建 implementer sub-agent**：传入任务描述（含「设计参照」字段）、Tech-Arch.md、Design-Brief.md 路径
2. **等待实现完成**：implementer 返回 DONE / DONE_WITH_CONCERNS / NEEDS_CONTEXT / BLOCKED
3. **需求对齐审查**（强制，借鉴 grill-with-docs）：
   - 对照 `Dev-Plan.md` 中该任务的验收标准，逐条打勾确认 ✅/❌
   - 对照 `Product-Spec.md` 领域术语表，检查实现的命名是否与术语一致
   - **如果任务有设计参照**：检查关键色值、间距、布局是否与 Design-Brief 规范一致
   - 对照 Tech-Arch.md ADR，检查技术选型是否偏离架构决策
   - 发现有偏离 → 标记为 DONE_WITH_CONCERNS，附具体偏离说明（偏离了哪条验收标准/术语/ADR）
4. **更新进度**：在 Dev-Plan.md 中标记任务完成

### Step 3: 整体集成
所有任务完成后，确保各部分能正常集成运行。

## 输出
- `<project-name>/` 目录下的完整项目代码
- `Dev-Plan.md` — 更新任务完成状态

## 参考资源
- [subagent-driven-development](references/superpowers/subagent-driven-development.md) — Sub-agent 驱动开发模式
- [karpathy-guidelines](references/andrej-karpathy-skills/karpathy-guidelines.md) — 编程准则
- `.claude/agents/implementer.md` — 实现者 sub-agent 定义
- `Dev-Plan.md` — 任务清单

## 注意
- 不要覆盖已有项目文件，和用户确认后再操作
- 如果遇到无法解决的问题，及时报告给用户
