# 阶段 6 技术设计：唯一 worktree 与跨代理复用

## 边界

阶段 6 只把任务记录中的 `worktree_path` 变成运行时唯一事实，覆盖三种
`workflow.worktree_mode`：`current-checkout`、`new-worktree`、
`existing-worktree`。不实现阶段 7 的 update/migration 兼容，不自动删除旧
目录，也不改变 Claude/Codex 入口文件的迁移策略。

## 设计决策

1. `task.json.worktree_path` 是唯一工作目录来源。任何 hook、pull-prelude、
   subagent 或 review dispatch 都读取该字段，不从 task 名、Markdown 或默认
   路径重新推导。
2. 共享运行时放在 `common/worktree_sync.py`，只读 resolver 与有副作用的
   create/merge 操作分开。SessionStart 与 dispatch 只能 resolve/sync，不能
   隐式创建或合并。
3. 新 worktree 的默认目录仍为
   `.trellis/trellis-worktrees/<task-dir-name>`；已记录的自定义路径和旧
   `.claude/worktree` / `.claude/worktrees/...` 仅按 `existing-worktree` 或
   已记录路径接受，不做自动迁移。
4. 所有路径先 canonicalize，再用 `git worktree list --porcelain` 和
   `git rev-parse --git-common-dir` 验证仓库归属；active task 之间的路径
   claim 必须唯一。
5. 当前会话已经位于 linked worktree 时，`new-worktree` 拒绝嵌套创建；调用
   方应改用 `current-checkout` 或 `existing-worktree`。
6. 合并只允许从已 claim 的任务分支合入同一仓库、干净且位于
   `base_branch` 的目标 checkout。冲突保留现场并给出 `git merge --abort`
   恢复提示，不自动清理。

## 运行时 API

`common/worktree_sync.py` 提供：

- `resolve_task_worktree(repo_root, task_dir_name, task_data)`
- `claim_task_worktree(repo_root, task_dir_name, task_data)`
- `merge_task_worktree(repo_root, task_dir_name, task_data, target_root=None)`

现有 bundle、planning snapshot、drift 和代码变更检测函数继续复用解析后的
`main_root/worktree_root`。

`task.py` 增加三个扁平命令：

- `resolve-worktree <task-dir> [--json]`：只读解析和诊断。
- `claim-worktree <task-dir> [--path PATH] [--branch BRANCH]
  [--base-branch BRANCH] [--replace-stale]`：按记录模式校验、创建/认领并
  原子写回路径、分支和 base branch。
- `merge-worktree <task-dir> [--target PATH] [--no-ff]`：执行最终合并。

命令失败时返回非零、保留 task.json 原值，并输出可恢复错误；重复对同一
健康 claim 执行 `claim-worktree` 必须幂等。

## Hook 与 dispatch 数据流

1. SessionStart 读取 active task 的 `task.json.worktree_path`，展示
   `Actual worktree: ...`，并仅对已解析的路径运行现有 bundle/snapshot/drift
   保护。
2. Claude PreToolUse 注入固定的 `Active task` 与 `Actual worktree` 两行，且
   记录路径存在时移除冲突的 host `isolation: worktree`。
3. Codex/Codex-compatible pull prelude 同样携带两行，并要求 worker 先读取
   task.json 校验路径一致；缺失或不一致时停止 dispatch。
4. 所有实现与 review agent 使用同一个 task/worktree，`fork_turns="none"`
   恢复时仍从 task.json 恢复，不依赖父会话 cwd。

## 兼容与回滚

- `current-checkout` 将当前 checkout 的 canonical path 写回 task record，
  但不创建 linked worktree。
- 已删除、未注册、归属其他仓库、分支不匹配或被其他 active task 占用的
  路径均拒绝；用户修复路径/分支后可重试。
- 阶段 6 不调用 `git worktree remove/prune`，不修改 `.claude` 历史目录。
- 可通过备份批次中的 `.bak` 恢复每个已修改模板文件。

## 风险控制

- Git 参数始终以参数数组传入 `run_git`，不使用 shell 拼接。
- 只在 Git 状态和 task record 校验通过后写 JSON；merge 冲突不写状态。
- 测试使用真实临时 Git 仓库和 linked worktree，避免仅用目录模拟掩盖归属问题。

## 最终审查记录

- spec-review、code-review、code-architecture-review：PASS。
- merge-review：主代理基于当前工作树完成，确认 task_store -> worktree_sync 依赖方向、primary task record 单一事实来源和 linked checkout 写回路径均符合设计。
- 最终验证：Core 16 files / 272 tests；CLI 45 files / 1,281 tests（1 file / 3 tests skipped）；typecheck、build、lint、diff-check、task validate 均通过。
