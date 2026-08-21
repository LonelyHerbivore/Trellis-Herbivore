# Spec Review

结论：PASS。

- 覆盖 current-checkout、new-worktree、existing-worktree。
- `task.json.worktree_path` 作为唯一事实来源，linked checkout 以 primary task record 为准。
- Claude/Codex dispatch 显式传播 Active task 与 Actual worktree，并保留 `fork_turns="none"` 恢复。
- 路径归属、分支、冲突、嵌套 worktree 与 merge 恢复均有实现和测试支撑。
- 最终验证覆盖 typecheck、build、lint、Core/CLI 全量测试与 `git diff --check`。
