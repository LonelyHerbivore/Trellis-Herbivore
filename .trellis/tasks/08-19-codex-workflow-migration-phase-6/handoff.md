# 阶段 6 交接

## 状态

阶段 6 已完成，三重 review gate 与最终集成 review 均通过：

- spec-review：PASS
- code-review：PASS
- code-architecture-review：PASS
- merge-review：PASS

## 已完成

- 三种 worktree 模式和 task-record-first 唯一 `worktree_path`。
- primary/linked checkout 归属、分支、base branch、冲突和嵌套创建校验。
- linked claim 写回 primary task.json；primary 缺失或损坏时 fail-closed。
- Claude/Codex dispatch 传播 `Active task` / `Actual worktree`，并恢复 `fork_turns="none"`。
- CLI 与 hook 的绝对路径、跨仓库路径和同仓库伪路径拒绝。
- runtime bundle 与 planning snapshot 只补缺失文件，保留用户定制。

## 验证

- `python -m py_compile`：通过。
- `pnpm --filter trellis-hgl exec vitest run test/scripts/task-worktree.integration.test.ts test/templates/shared-hooks.test.ts --testTimeout=30000 --reporter=dot`：2 files、44 tests passed。
- `pnpm --filter trellis-hgl-core test -- --reporter=dot`：16 files、272 tests passed。
- `pnpm test -- --reporter=dot`（提交后复核）：CLI 45 files、1,281 tests passed，1 file/3 tests skipped。
- `pnpm test -- --reporter=dot --testTimeout=30000`（完整门禁复核）：CLI 45 files、1,281 tests passed，1 file/3 tests skipped。
- `pnpm typecheck`：通过。
- `pnpm build`：通过。
- `pnpm lint`：通过。
- `git diff --check`：通过。

## 备份

- 阶段 6 的 11 个 edit-backup-guard 批次均已 finalize，目录均位于 `.codex-backups/`，批次前缀为 `20260821-172657`、`20260821-214054`、`20260821-224936`、`20260822-002518`、`20260822-003253`、`20260822-003927`、`20260822-004414`、`20260822-010258`、`20260822-011751`、`20260822-012226`、`20260822-013053`。
- 需要回滚时，按对应 `manifest.json` 使用 `originals/*.bak` 恢复，或审阅 `patches/*.patch` 后重新应用；本阶段未提交备份目录本身。

## 下一步

阶段 7 尚未启动。后续仅需在新的阶段任务中确认阶段 6 提交已存在、工作树干净且阶段 6 交接可追溯；本阶段不执行任何阶段 7 工作。
