# 阶段 7 实施记录

## 顺序

1. 读取阶段 6 交接、现有 update/migration、manifest、fixture 与测试，锁定阶段 7文件边界。
2. 先补真实版本跳跃、mixed ownership、conflict-only、失败恢复、runtime preservation、manifest prune 和 root symlink fixture。
3. 在 `update.ts` 中补齐 legacy Codex 迁移、review agents、hooks/dispatch mode、backup/restore、runtime exclusion、manifest no-op 持久化和 symlink fail-closed。
4. 运行定向 Vitest，随后运行既有 orphan-manifest 回归、workspace 全量测试、build、typecheck、lint、Python compile、task validate 和 diff-check。
5. 由独立只读 agent 依次执行 spec-review、code-review、code-architecture-review 与 merge-review；任何 FAIL 均回到实现并重跑后续 gate。
6. 仅暂存阶段 7文件并创建唯一提交；提交成功后才进入阶段 8。

## 当前验证快照

- `update.integration.test.ts` + `update-internals.test.ts`：2 files、111 passed。
- `init-uninstall-overdelete.integration.test.ts`：14 passed。
- workspace 全量历史快照：Core 16 files / 272 passed；CLI 45 passed files、1 skipped file，1297 passed、3 skipped。
- workspace 全量最新结果：Core 16 files / 272 passed；CLI 45 passed files、1 skipped file，1300 passed、3 skipped。
- pnpm typecheck、pnpm build、pnpm lint：通过（并行验证时 build 受产物清理竞态影响，随后串行重跑通过）。
- py -3 -m compileall -q .trellis/scripts packages/cli/src/templates/trellis/scripts：通过。
- py -3 .trellis/scripts/task.py validate .trellis/tasks/08-19-codex-workflow-migration-phase-7：通过。
- git diff --check：通过。
## Review gate

- spec-review：PASS；覆盖真实版本跳跃 fixture、symlink、mixed ownership、失败恢复与 non-native hash。
- code-review：PASS；确认 rename-dir 不会删除受保护用户数据，manifest prune no-op 会持久化，冲突路径保持 pending。
- code-architecture-review：PASS；未发现无调用方抽象、重复迁移框架、推测性兼容或额外依赖；全局 managed-root symlink 保护按 fail-closed 假设记录。
- merge-review：PASS；独立 agent 复核 staged 边界、阶段8/9隔离、数字一致性和 git diff --cached --check。