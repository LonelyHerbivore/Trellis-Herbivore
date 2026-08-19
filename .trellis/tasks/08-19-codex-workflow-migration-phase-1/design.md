# 阶段 1 设计：结构化任务状态与跨会话恢复

## 决策

在 `TrellisTaskRecord` 中新增可选的版本化工作流状态字段（名称由实施 agent 依照现有命名风格确定）。它不是自由 `meta`：Core 必须能够强类型读取、规范化和验证，Python task writer 必须写出同一 JSON 合同。旧记录缺失该字段时返回 legacy 表示，不修改磁盘文件，也不要求迁移。

## 状态结构

新状态合同至少包含以下概念；最终 JSON 字段命名保持 ASCII，并在 TypeScript 和 Python 中完全一致。

| 概念 | 值或规则 |
| --- | --- |
| 合同版本 | `legacy` 或 `explicit-selection-v1`；只有后者表示策略已由用户明确选择。 |
| 宿主平台 | `claude` 或 `codex`，由创建/恢复会话记录。 |
| 执行模式 | `main-session` 或 `subagent`。 |
| worktree 选择 | `current-checkout`、`new-worktree`、`existing-worktree`；必须与顶层 `worktree_path` 一致。 |
| 开发流程 | `default` 或 `tdd`。 |
| review 选择 | 四个固定 gate 各出现一次，且 enabled 与 disabled 无交集、并集完整。 |
| gate 执行状态 | enabled gate 为 `pending`、`PASS`、`FAIL` 或 `skipped`；状态含非负尝试次数与可选报告相对路径。disabled gate 不得记录执行成功或失败。 |

`worktree_path` 仍是唯一实际工作目录，避免 JSON 内外保存两个可能漂移的路径。task 的普通 `status` 仍负责生命周期阶段；本合同不复制或替代 `planning`、`in_progress`、`review`、`completed`。

## 兼容策略

1. `loadTaskRecord()` 读取旧的 24 字段记录时成功，并返回清晰的 legacy 表示。
2. 新字段缺失不构成 task record 错误；字段出现时必须完整符合 `explicit-selection-v1` 结构。
3. 不接受未知合同版本、半选状态、重复/遗漏 gate、非法依赖、负 attempts、绝对报告路径或与 `worktree_path` 冲突的选择。
4. `writeTaskRecord()` 必须保留既有未知字段和其顺序契约；不在读旧记录时自动写入新字段。
5. Python writer 对新 task 写入可编辑的未选择状态或结构化空值；Python validator 能给出具体字段错误且不把 legacy task 误判为失败。

## 所有权与文件边界

Core 负责结构、解析、规范化与纯验证：`packages/core/src/task/schema.ts`、`records.ts` 及其 task tests。CLI 模板脚本负责创建、读取、显示和命令行错误：`packages/cli/src/templates/trellis/scripts/task.py`、`common/task_store.py`、`common/task_context.py` 或紧邻模块。阶段 1 不引入命令行交互；Claude/Codex 的宿主提示与策略收集留给阶段 2/5/6。

## 测试矩阵

- Core：legacy load、显式状态 round-trip、非法字段、gate partition、attempts/report path、worktree 一致性、unknown-field preservation。
- Python：新 task 初始状态、legacy task validate、显式状态 validate、每一种非法状态的错误和非零退出。
- 跨宿主 fixture：同一 JSON 由 Claude/Codex 入口恢复时只依赖该结构化状态，不从 Markdown 推断。
- 回归：现有 24 字段 fixture 和 init/update 写入的 legacy aliases 保持可读。

## 风险与回滚

最大风险是把新增字段设为必填，导致旧任务全部失败；测试必须先锁定 legacy 行为。阶段 1 的提交是回滚边界：如阶段 2/5/6 发现合同不足，只追加兼容性修复，不通过修改旧 task 或重写阶段 1 提交掩盖问题。
