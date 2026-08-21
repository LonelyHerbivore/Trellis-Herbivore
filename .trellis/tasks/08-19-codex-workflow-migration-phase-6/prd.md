# Codex 工作流无缝迁移 - 阶段 6：唯一 worktree 与跨代理复用

## 目标

确保每个任务只有一个事实工作目录，所有实现、测试、review 与合并步骤复用它。

## 需求

- 支持 current checkout、新建 worktree、已有 worktree，默认路径为 `./.trellis/trellis-worktrees/<task-dir-name>`。
- 当前已经在 worktree 时复用它；兼容旧 `.claude/worktree` 和 task 已记录路径。
- 所有 agent dispatch 显式携带 task 和 worktree 路径，并连接 sync、runtime bundle、snapshot、base branch 与最终合并。

## 通用工程约束

- 只为已确认的阶段需求增加内容；除非已有调用路径或 PRD 明确证明必要，不增加面向假设场景的抽象、配置、兼容分支、兜底逻辑或重复校验。
- 阶段验收与架构审查必须核查新增代码和测试是否直接支撑需求；发现未被需求或实际调用证明的复杂度时，删除或记录其必要性。

## 验收标准

- [x] 四种选择场景、跨宿主/agent 同路径和 `fork_turns="none"` 恢复均有测试。
- [x] 路径无效、删除、归属冲突或分支不匹配给出可恢复错误。
- [x] 同一任务不会创建两个 Trellis-managed worktree。

## 阶段 6 验收记录

- 三重 review gate：spec-review、code-review、code-architecture-review 均 PASS。
- linked checkout 的 task record、claim 与 merge 均锚定 primary checkout；primary
  task.json 缺失或损坏时 fail-closed。
- 定向 worktree/hook 测试：44 passed；Core 测试：272 passed。
- 最终验证：typecheck、build、lint、CLI 全量测试均通过；结果详见 `handoff.md`。
