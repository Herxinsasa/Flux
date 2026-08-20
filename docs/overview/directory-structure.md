# FluxV2 文档与开发规范落地说明

> 规范来源：`F:\Dev\Agent Skills\harness-doc`
> 适用分支：`baseline2.0`
> 生效日期：2026-08-05

## 1. 规范优先级

FluxV2 后续开发按以下优先级执行：

1. 用户在当前需求中明确指定的约束。
2. FluxV2 既有代码风格和项目文档。
3. `.claude/constraints/` 中同步自 harness-doc 的规范。
4. TypeScript、React、Electron 等技术栈通行惯例。

项目内生效副本：

- 编码规范：`.claude/constraints/coding-req.md`
- 日志规范：`.claude/constraints/log-req.md`
- 目录规范：`.claude/constraints/directory-spec.md`

## 2. 文档路径

| 文档类型 | 路径规则 |
|---|---|
| 项目总览 | `docs/overview/` |
| 需求规格 | `docs/requirements/<iteration>-<topic>-req.md` |
| 影响面分析 | `docs/requirements/<iteration>-<topic>-impact.md` |
| 需求设计 | `docs/design/<iteration>-<topic>-req-design.md` |
| 接口契约 | `docs/protocol/<iteration>-<topic>-contract.md` |
| UI 设计 | `docs/ui/<iteration>-<topic>-ui.md` |
| 开发计划 | `docs/plan/<iteration>-<topic>-dev-plan.md` |
| 测试报告 | `docs/test/<iteration>-<topic>-test-report.md` |
| 架构总览 | `docs/overview/architecture.md` |
| 仓库级模块文档 | `docs/modules/<module-name>/README.md` |

`docs/plan/` 是 FluxV2 为 DevFlow 增加的项目级扩展，用于保存可恢复的任务状态和执行记录。其余路径遵循 harness-doc 的扁平英文目录规范。

## 3. 文件命名

- 目录和普通文档使用小写英文。
- 多词使用 kebab-case。
- 迭代文档必须以前缀标识迭代，例如 `baseline2.0-team-ai-markdown-req.md`。
- `README.md`、`CLAUDE.md` 和模块文档 `README.md` 保留约定名称。
- 不创建无内容目录；在 DevFlow 产生对应文档时再创建目录。

## 4. DevFlow 路径映射

FluxV2 已将 DevFlow 默认的编号中文目录替换为本文件定义的英文路径。后续 Skill、子 Agent、审查和测试流程必须使用上表路径，不得重新创建 `docs/02-需求`、`docs/04-设计`、`docs/05-UI`、`docs/06-测试` 或 `docs/08-计划`。

当前迭代需求入口：

- `docs/requirements/baseline2.0-team-ai-markdown-req.md`

