---
name: code-review
description: 代码审查。调度独立 code-reviewer Agent，对 dev-builder 完成后的代码变更做迭代级审查，检查需求一致性、UI 契约、修改范围、代码质量、安全性、性能、回归风险和测试充分性。审查通过后写入审查状态，未审查的代码不允许提交。
---

# Code Review - 代码审查

## 定位

`code-review` 是编码后的迭代级审查门。

`dev-builder` 关注“当前任务是否按计划完成”；`code-review` 关注“本次代码变更整体是否安全、完整、不过度，是否会破坏既有行为”。

未经审查的代码不得提交。审查通过后写入 `.claude/.review-status.json`，由 `code-committer` 和 Git `pre-commit` 校验。

---

## 核心原则

1. **独立审查。** 每次审查创建新的 `code-reviewer` Agent，不继承编码上下文。
2. **以输入文档为准。** 审查依据开发计划、需求设计文档、界面设计文档、编码规范和实际 diff。
3. **问题优先。** 审查报告先列问题，再给总结；问题按严重程度排序。
4. **不过度放行。** Critical 和 Important 问题必须修复，不进入测试或提交。
5. **不过度挑剔。** Suggestion 不阻塞流程，只记录改进建议。

---

## 触发场景

- `dev-builder` 完成一个或一组任务后。
- 开发计划中所有可执行任务完成后。
- 用户说“审查代码”“code review”“看下这次改动风险”。

---

## 输入

| 输入 | 用途 |
|------|------|
| 开发计划 | 确认任务、状态、验收标准和执行记录 |
| 需求设计文档 | 确认需求项、编码上下文、契约设计和验证计划 |
| 界面设计文档 | 涉及 UI 时确认界面契约和 UI 验收方式；前端技术设计从需求设计读取 |
| `dev-builder` 执行记录 | 确认任务级执行结果、修改摘要、验证结果 |
| 变更文件列表 / diff | 审查实际代码变更 |
| 开发计划代码基线 | 排除迭代开始前已有的用户改动，确定本次审查边界 |
| 编码规范和现有代码事实 | 审查代码风格、错误处理、测试、日志和架构边界 |

没有 UI 影响时，不需要界面设计文档。

---

## 工作流程

### Step 0：检查 code-reviewer 可用性

确认 Agent 工具能够发现并调用 `.claude/agents/code-reviewer.md`。如果不可用，返回 `BLOCKED_AGENT_UNAVAILABLE`，不得由主 Agent 模拟独立审查，也不得写入通过状态。复制或修改 Agent 文件后需重启 Claude Code 才能在新会话中发现。

### Step 1：确定审查范围

先确认本次审查范围：

| 范围 | 说明 |
|------|------|
| 任务级审查 | 审查一个或少量已完成任务的改动 |
| 迭代级审查 | 审查当前需求迭代的全部改动 |
| 指定文件审查 | 用户指定文件或目录 |

默认选择迭代级审查。若只审查部分任务，必须在报告中说明未覆盖范围。

审查范围以开发计划的基线提交、迭代开始时已有变更、任务目标文件和 `dev-builder` 执行记录共同确定。不得把无法证明属于本次迭代的已有改动自动纳入审查结论。

### Step 2：组装审查输入

传给 `code-reviewer` 的输入必须包含：

```text
□ 审查范围
□ 变更文件列表或 diff
□ 开发计划路径和相关任务
□ 需求设计文档路径和相关需求项
□ 界面设计文档路径和界面契约（如涉及 UI）
□ dev-builder 执行记录和任务级审查结果
□ 编码规范或项目现有代码风格说明
□ 项目代码约定（编码（字符集 + BOM）与行尾、风格要点、代表性样例文件路径）
```

不要把无关历史讨论塞给 reviewer，避免污染判断。

### Step 3：派独立 code-reviewer

使用 Agent 工具创建新的 `code-reviewer` Agent。

必须记录实际执行的 `agent_name=code-reviewer` 和 `agent_id`；无法取得 ID 时记录工具返回的等价执行标识。

审查重点：

| 维度 | 检查内容 |
|------|---------|
| 需求一致性 | 是否满足关联需求项和验收标准，是否遗漏任务 |
| UI 契约 | 涉及 UI 时是否符合界面契约、状态、交互和验收方式 |
| 修改范围 | 是否越界修改、是否引入计划外功能或无关重构 |
| 代码质量 | 命名、结构、可读性、错误处理、边界条件 |
| 安全性 | 输入校验、权限、敏感信息、注入、越权 |
| 性能 | 热路径、重复计算、阻塞 UI 线程、资源释放 |
| 回归风险 | 是否破坏既有接口、配置、数据兼容和旧行为 |
| 测试充分性 | 测试或验证是否覆盖关键路径、异常路径和 UI 状态 |

### Step 4：处理审查结论

审查结论用中文规则表达：

| 结论 | 含义 | 后续动作 |
|------|------|---------|
| 通过 | 没有阻塞问题 | 写入审查状态，进入测试 |
| 有条件通过 | 只有可接受风险或建议项，且不影响当前交付 | 写入审查状态，记录接受原因，进入测试 |
| 不通过：代码质量 | 存在必须修复的代码质量、可维护性或边界问题 | 回到 `dev-builder` 修复 |
| 不通过：需求不一致 | 实现偏离需求项、需求设计或开发计划 | 回到 `dev-builder`；若设计本身不清，回到 `design-writer` |
| 不通过：UI 不一致 | UI 实现偏离界面契约或遗漏状态/交互 | 回到 `dev-builder`；若界面契约缺失，回到 `ui-designer` |
| 不通过：回归风险 | 可能破坏既有行为、兼容性、数据或接口 | 回到 `dev-builder` 修复，并提高 `code-tester` 测试深度 |
| 不通过：输入不足 | 缺少审查所需文档、diff、执行记录或规范 | 补齐输入后重新审查 |

严重程度规则：

- **Critical**：会导致功能错误、数据损坏、安全问题、严重回归或无法交付。必须修复。
- **Important**：明显偏离需求、设计、边界或质量要求。必须修复。
- **Suggestion**：不阻塞交付的改进建议。可记录，不阻塞。

### Step 5：写入审查状态

只有独立 `code-reviewer` 实际执行且结论为“通过”或“有条件通过”后，才能写入：

```text
.claude/.review-status.json
```

先对本次已审查代码文件生成内容快照：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .claude/hooks/review-check.ps1 -Snapshot -Files <已审查代码文件列表>
```

把输出的 `reviewed_files`、`reviewed_file_hashes` 和 `diff_fingerprint` 原样写入审查状态。内容哈希用于判断文件是否在审查后再次修改，不使用固定时间窗口代替代码版本校验。

建议结构：

```json
{
  "last_review": "<时间戳>",
  "review_agent_name": "code-reviewer",
  "review_agent_id": "<Agent 执行标识>",
  "iteration": "<需求迭代编号>",
  "development_plan": "<开发计划路径>",
  "reviewed_tasks": ["TASK-001"],
  "reviewed_requirements": ["REQ-001"],
  "reviewed_files": ["文件列表"],
  "reviewed_file_hashes": {
    "src/example.cpp": "<git blob hash>"
  },
  "diff_fingerprint": "<快照指纹>",
  "review_scope": "full",
  "ui_contract_checked": true,
  "conclusion": "通过",
  "accepted_risks": [],
  "review_summary": "一句话摘要"
}
```

如果是部分审查，必须记录 `review_scope: "partial"` 和未覆盖任务。

### Step 6：生成提交信息草稿（通过/有条件通过时）

审查结论为“通过”或“有条件通过”时，按 `code-committer` 的提交信息模板附带生成一份 commit message 草稿，供用户直接使用：

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

要求：

- 草稿按本次审查覆盖的需求项和任务汇总新增/修改/修复。
- 此步骤只生成草稿，不执行提交；提交仍须用户明确要求并走 `code-committer`。
- 审查通过后代码可能再经 `code-tester`/`bug-fixer` 变动，`code-committer` 提交前刷新最终版。

---

## 输出

审查报告格式：

```markdown
# 代码审查报告

## 结论

通过 / 有条件通过 / 不通过：<原因>

## 问题

| 严重程度 | 文件 | 问题 | 影响 | 建议处理 |
|---------|------|------|------|----------|
| Critical / Important / Suggestion | | | | |

## 覆盖范围

| 项 | 内容 |
|----|------|
| 开发计划 | |
| 需求项 | |
| 任务 | |
| 文件 | |
| UI 契约 | 已检查 / 不涉及 / 未覆盖 |

## 回退路由

| 问题类型 | 回到哪个环节 | 原因 |
|---------|-------------|------|
| | | |
```

审查结论为“通过”或“有条件通过”时，随报告附带按 `code-committer` 模板生成的 commit message 草稿（不执行提交）。

---

## 自审查

输出前检查：

```text
□ 是否使用独立 code-reviewer Agent？
□ code-reviewer 不可用时是否阻止主 Agent 模拟审查和写入通过状态？
□ 审查状态是否记录 review_agent_name 和 review_agent_id？
□ 是否说明审查范围？
□ 是否覆盖开发计划、需求设计文档和实际 diff？
□ 涉及 UI 时是否检查界面契约？
□ 是否检查计划外功能、越界修改和无关重构？
□ Critical / Important 是否没有被放行？
□ 有条件通过是否记录了接受原因？
□ 审查通过后是否写入 .review-status.json？
□ 审查状态是否包含当前已审查代码的文件哈希和 diff 指纹？
□ 通过/有条件通过时是否附带 commit message 草稿，且未执行提交？
```
