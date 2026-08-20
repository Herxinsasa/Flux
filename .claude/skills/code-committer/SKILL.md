---
name: code-committer
description: 提交辅助。用户明确要求提交、commit、发布或生成 changelog 时触发；提交前检查开发计划状态、code-review 状态、code-tester 测试结果和编译结果。编译失败路由到 bug-fixer，不自动提交。
---

# Code Committer - 提交辅助

## 定位

`code-committer` 是 DevFlow 的最后一步。它只在用户明确要求时触发，不自动提交。

提交前必须确认：

- 开发计划状态可提交。
- code-review 已通过或有条件通过。
- code-tester 测试通过。
- 编译/构建检查通过。
- git 变更清单没有误提交文件。

编译失败不提交，路由到 `bug-fixer` 修复编译问题。

---

## 触发场景

- 用户说“提交”“commit”“发布”“我要提交了”。
- 用户说“生成 changelog”“写 commit message”。

---

## 输入

| 输入 | 用途 |
|------|------|
| 开发计划 | 检查任务状态和本次迭代范围 |
| code-review 状态 | 检查审查结论和覆盖文件 |
| code-tester 测试报告 | 检查测试结论 |
| git status / diff | 汇总实际变更，排除误提交 |
| 需求设计文档 / 需求项 | 生成 changelog 和 commit message |

---

## 工作流程

### Step 1：检查开发计划状态

确认：

```text
□ 本次计划内任务已完成，或用户明确允许部分提交
□ 阻塞任务已说明，不会被误认为已完成
□ 执行记录完整
```

有未完成任务时，先向用户说明，不自动提交。

### Step 2：检查审查状态

读取：

```text
.claude/.review-status.json
```

允许继续：

- 结论为“通过”。
- 结论为“有条件通过”，且接受风险已记录。

不允许继续：

- 没有审查状态。
- 审查范围是 partial 且未覆盖本次提交文件。
- 审查状态缺少 `reviewed_file_hashes`。
- 审查状态缺少 `review_agent_name=code-reviewer` 或 `review_agent_id`。
- 本次暂存代码不在审查范围，或文件内容与审查快照不一致。
- 结论为“不通过”。

### Step 3：检查测试结果

读取 code-tester 测试报告或当前会话测试结论。

测试失败或待复现时不提交，按测试报告路由。

### Step 4：编译/构建检查

提交前必须确保 Git pre-commit 检查已启用。先读取当前仓库配置：

```powershell
git config --get core.hooksPath
```

如果输出不是 `.claude/hooks`，由 `code-committer` 自动设置：

```powershell
git config core.hooksPath .claude/hooks
```

该设置只影响当前仓库，不写入提交。

根据项目类型执行编译或构建检查：

| 项目类型 | 检查 |
|---------|------|
| xmake | `xmake build` |
| CMake | `cmake --build build` |
| Node.js | `npm run build` |
| Rust | `cargo build` |
| Go | `go build ./...` |
| .NET | `dotnet build` |
| Python | `python -m compileall` 或项目测试命令 |

编译失败时：

1. 记录失败命令和错误日志。
2. 不提交。
3. 路由到 `bug-fixer`。
4. 修复后重新测试和编译。

### Step 5：获取改动清单

使用 `git status` 和必要的 diff 汇总：

- 新增文件。
- 修改文件。
- 删除文件。
- 未跟踪文件。
- 可能误提交的编译产物、日志、临时文件、缓存文件。

发现可疑文件时，先让用户确认。

### Step 6：生成 changelog 和提交信息

按需求项和开发计划任务汇总：

```markdown
## Changelog

新增:
- <需求项 / 任务对应的新增能力>

修改:
- <需求项 / 任务对应的修改>

修复:
- <Bug 或测试失败修复>

验证:
- code-review：通过 / 有条件通过
- code-tester：通过
- 编译：通过
```

commit message：

```text
<需求迭代编号>: <需求主题>

新增:
- ...
修改:
- ...
修复:
- ...
验证:
- review/test/build passed
```

commit message 要点约束：

- 每条要点不超过 20 个字，简短精炼。
- 动词开头，写清做了什么，不展开背景与细节。
- 详细说明放 changelog，commit message 只保留精炼要点。

### Step 7：用户确认后提交

展示：

- git 变更清单。
- changelog。
- commit message。

用户确认后执行 `git add` 和 `git commit`。

推送不默认执行。只有用户明确要求 push 时才推送。

---

## hooks 关系

| Hook | 时机 | 与本 Skill 的关系 |
|------|------|------------------|
| Git pre-commit / `review-check.ps1` | git commit 前 | 校验暂存代码均已审查且内容未在审查后变化 |
| Git pre-commit / `pre-commit-check.ps1` | git commit 前 | 执行编译检查；失败阻止提交并路由 `bug-fixer` |

`code-committer` 是主动提交流程；Git hooks 是提交前兜底保护。Claude 正常停止输出不代表编码完成，因此不使用 Stop hook 作为业务门禁。DevFlow 不使用 post-commit 自动推送。

---

## 输出

- changelog。
- commit message。
- 提交前检查结果。
- git commit 结果。
- 如失败，输出回退路由。

---

## 自审查

```text
□ 是否用户明确要求提交？
□ 开发计划是否允许提交？
□ code-review 是否通过或有条件通过？
□ 本次代码是否与 code-review 记录的文件哈希一致？
□ code-tester 是否通过？
□ 编译是否通过？
□ 编译失败是否路由到 bug-fixer？
□ 是否检查误提交文件？
□ 是否经用户确认后提交？
□ commit message 要点是否不超过 20 字、简短精炼？
□ 是否没有默认 push？
```
