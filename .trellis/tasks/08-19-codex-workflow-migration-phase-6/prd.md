# Codex 工作流无缝迁移 - 阶段 6：唯一 worktree 与跨代理复用

## 目标

确保每个任务只有一个事实工作目录，所有实现、测试、review 与合并步骤复用它。

## 需求

- 支持 current checkout、新建 worktree、已有 worktree，默认路径为 `./.trellis/trellis-worktrees/<task-dir-name>`。
- 当前已经在 worktree 时复用它；兼容旧 `.claude/worktree` 和 task 已记录路径。
- 所有 agent dispatch 显式携带 task 和 worktree 路径，并连接 sync、runtime bundle、snapshot、base branch 与最终合并。

## 验收标准

- [ ] 四种选择场景、跨宿主/agent 同路径和 `fork_turns="none"` 恢复均有测试。
- [ ] 路径无效、删除、归属冲突或分支不匹配给出可恢复错误。
- [ ] 同一任务不会创建两个 Trellis-managed worktree。
