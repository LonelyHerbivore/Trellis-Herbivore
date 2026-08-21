# 阶段 6 实施计划

## 实施顺序

1. 新增 `common/worktree_sync.py` 的 task-scoped resolver、Git worktree
   porcelain 解析、claim/create 和 merge helper；保持现有 sync/snapshot/drift
   API 兼容。
2. 在 `task.py` / `task_store.py` 注册 resolve、claim、merge 三个命令；补齐
   canonical path、仓库归属、active-task claim 唯一性、分支和 base branch 校验。
3. 更新 shared/Codex SessionStart、Claude dispatch hook 和 Codex pull-prelude，
   显式传播 `Active task` 与 `Actual worktree`，并让已记录路径驱动 bootstrap。
4. 增加真实 Git 集成测试与 hook/prelude 回归测试：四种选择场景、跨宿主同路径、
   `fork_turns="none"` 恢复、删除/归属冲突/分支不匹配/无嵌套、sync/snapshot、
   merge 成功/冲突恢复。
5. 更新任务 workflow 文本和模板断言，确保文档合同与运行时一致。

## 验证顺序

1. 定向 Python/CLI/Vitest 测试。
2. `pnpm typecheck`、`pnpm build`、`pnpm lint`、`pnpm test -- --reporter=dot`。
3. `git diff --check` 与 `task.py validate`。
4. `spec-review`、`code-review`、`code-architecture-review` 三个 gate 依次
   独立执行；任一失败则回到实现并重跑后续 gate。
5. 主代理执行最终集成/合并 review，再跑最终 build/test；不启动阶段 7。

## 回滚点

- 每个修改批次先由 `edit-backup-guard` 创建 `.bak` 与 `.patch`。
- 运行时 API 若破坏旧 hook fixture，优先恢复调用方适配，不改变已有
  `sync_runtime_bundle` 的 drift/dirty-code 保护语义。
- Git merge 冲突只提示恢复命令，不自动 reset、abort 或删除 worktree。

## 阶段收尾记录

- 唯一事实：linked checkout 的 task 解析、claim 与 merge 均以 primary checkout 的 `task.json` 为准；primary 缺失或损坏时 fail-closed。
- 路径身份：CLI 与 hook 拒绝跨仓库绝对路径、同仓库非 `.trellis/tasks` 路径和 basename 冒用。
- Review gate：spec-review、code-review、code-architecture-review 均 PASS；主代理已完成最终集成 review。
- 定向验证：`task-worktree.integration.test.ts`（19）与 `shared-hooks.test.ts`（25）共 44 项通过；Python 模板 `py_compile` 通过。
- 全量验证：Core 16 files / 272 tests；CLI 45 files / 1,281 tests，1 file skipped / 3 tests skipped。
- `pnpm typecheck`、`pnpm build`、`pnpm lint`、`pnpm test -- --reporter=dot` 与 `git diff --check` 均通过。
