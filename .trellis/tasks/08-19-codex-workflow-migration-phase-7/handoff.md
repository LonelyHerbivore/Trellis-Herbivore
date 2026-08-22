# 阶段 7 交接

## 状态

阶段 7 实现、定向验证、四道 review gate 和唯一提交均已完成；阶段 8现可启动，完成后立即停止。

- spec-review：PASS
- code-review：PASS
- code-architecture-review：PASS
- merge-review：PASS；独立复核 staged 边界、数字一致性和 diff-check

## 已完成

- 旧 Codex .agents/skills 布局、agent rename/skill path、hooks、dispatch mode 和 review agents 的真实版本跳跃迁移。
- pristine、用户修改、目标已存在、--migrate、dry-run、force、skipAll、conflict-only、backup 和失败恢复路径。
- Claude + Codex mixed 项目的平台 ownership 与 update 顺序；共享 .agents/skills 中其他工具的文件不会误装 Codex 内容。
- non-native workflow hash 契约、manifest prune no-op 持久化、workspace/tasks/spec/backlog/worktree/runtime 排除。
- root instruction、managed root、预置 backup 目录、backup/restore 目标 symlink/junction 的 fail-closed 保护；POSIX mode 和毫秒级 backup 唯一性也已覆盖。
- rename-dir 目标含用户数据时拒绝安全替换，避免误删历史 workspace/spec/tasks/backlog。

## 验证

- 定向迁移：update.integration.test.ts + update-internals.test.ts，2 files / 111 passed。
- 相关 over-delete 回归：14 passed。
- Core 全量：16 files / 272 passed。
- CLI 全量：45 files passed、1 skipped file，1300 passed、3 skipped。
- pnpm typecheck、pnpm build、pnpm lint、git diff --check、Python compile、task.py validate：通过。

## 备份

阶段 7 修改批次均已创建 edit-backup-guard 备份，提交前 finalize：

- 20260822-113359-阶段7阶段8迁移兼容与发布验收（update 与阶段 8 预存发布文件）
- 20260822-121130-阶段7迁移回滚与fixture补强
- 20260822-124004-阶段7运行时排除与符号链接回滚测试
- 20260822-125415-阶段7修复运行时备份排除与manifest回滚边界

备份目录位于 .codex-backups/，不进入提交；恢复使用对应 originals/*.bak 或审阅 patches/*.patch。

## 阶段 8入口

阶段 8仅验证已发布 CLI/core tarball 与 clean-install consumer E2E：复用现有 release-preflight、pack-publish-artifacts、verify-packed-cli，不提前修改阶段 9的最终集成流程。阶段 8完成提交后立即停止。