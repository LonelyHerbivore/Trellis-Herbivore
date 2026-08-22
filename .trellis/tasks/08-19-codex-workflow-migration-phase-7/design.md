# 阶段 7 技术设计：历史项目 update/migration 兼容

## 边界

本阶段只处理已经存在的项目在 `trellis update` / `--migrate` 中的兼容与恢复，不修改 npm tarball、pack、clean-install E2E 或阶段 9 最终集成。实现继续复用现有 migration manifest、template hash、update skip、backup 和 prompt API。

## 设计决策

1. 以真实版本跳跃 fixture 驱动迁移分类，覆盖旧 Codex `.agents/skills`、agent rename、skill path、hooks、`codex.dispatch_mode` 和新增 review agents。
2. mixed Claude+Codex 项目仍按已有平台 configurator ownership 更新：用户入口、hooks、共享 `.agents/skills` 和 runtime 数据分别保护，其他工具在 `.agents/skills` 中的文件不被误装。
3. update 先创建受保护的 managed snapshot，再执行迁移、删除和模板写入；runtime、workspace、tasks、spec、backlog、worktree 和 trace 数据不进入 snapshot。快照目录预置 symlink、managed root symlink、root instruction symlink 和恢复目标 symlink 均 fail-closed 或跳过写入。
4. orphan manifest prune 在普通更新和 no-op 更新都持久化；dry-run 不写盘。失败恢复只恢复 Trellis 管理文件，保留运行时和用户数据。
5. conflict-only migration 仍属于 pending work，不能走 no-op early return；`force` 不绕过冲突目标的 ownership 保护，`skipAll`、dry-run 和失败路径保持现有语义。
6. 不新增平台注册表或通用迁移框架；所有逻辑局部落在现有 `update.ts` 调用链中，测试直接覆盖真实临时项目。

## 保护边界

- 不修改 `.gitignore`、`%SystemDrive%/`、阶段 8 release-preflight 文件或其他既有无关改动。
- `.codex-backups/` 只保存 edit-backup-guard 证据，不进入提交。
- non-native workflow 继续由既有 hash 契约管理，不把用户工作流内容转成 Trellis native hash。