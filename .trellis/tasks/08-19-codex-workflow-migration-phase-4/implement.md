# 阶段 4 实施记录与执行计划

## 执行顺序

1. 读取 CLI config / template / test 规范，确认 Python、prompt、文件写入与 backup 的既有约定。
2. 为将修改的既有源码、模板、测试和任务记录启动独立 `edit-backup-guard` 批次；不把 `.gitignore` 放入批次或暂存范围。
3. 收敛 Codex skill 安装职责：移除失效的 `.codex/skills` 收集链，迁移仍被引用的 `break-loop` 到 common，更新共享入口 fallback 与相关测试。
4. 新增窄范围用户级 Codex 配置 helper，并在 Codex init/update 的真实后置路径调用；实现 cc-switch 优先、TOML fallback、独立确认、备份和无阻塞降级。
5. 补充单元、配置器、init/update 集成测试，并运行 build 后的 source → dist → tarball → 临时项目验证。
6. 依次执行 spec-review、code-review、code-architecture-review；任一 FAIL 由主会话修复并只重跑当前 gate。
7. 运行范围匹配测试、`pnpm typecheck`、`pnpm build`、`pnpm lint`、全量测试；记录真实结果。
8. finalize 本阶段备份批次，更新 PRD/task/中文交接，排除 `.gitignore` 后创建固定提交。

## 预期修改面

- `packages/cli/src/templates/common/`、`packages/cli/src/templates/codex/`、`packages/cli/src/configurators/`
- `packages/cli/src/commands/init.ts`、`packages/cli/src/commands/update.ts` 与一个有调用方的用户配置 utility
- 贴近上述行为的 CLI unit / template / configurator / init / update 测试
- 阶段 4 task 文档与交接记录

## 验证命令

```text
pnpm --filter trellis-hgl test -- <阶段 4 相关测试文件>
pnpm --filter trellis-hgl typecheck
pnpm --filter trellis-hgl build
pnpm --filter trellis-hgl lint
pnpm --filter trellis-hgl pack --pack-destination <临时目录>
pnpm typecheck
pnpm build
pnpm lint
pnpm test -- --reporter=dot
git diff --check
```

## 审查标准

- spec-review：每个 PRD 条目都有可执行证据；不把 hooks feature 写到项目级 config，也不把项目确认当成用户级确认。
- code-review：独立确认、cc-switch 优先、TOML 保留、失败降级和 init/update 路径无遗漏。
- code-architecture-review：没有第二套 Codex skill 源、无重复 workflow 文案、无无调用方 abstraction、无推测性兼容或过度兜底。

## 回滚点

- 代码改动前的 `.codex-backups/<batch>/originals` 与 `patches`。
- 用户级配置文件或 cc-switch 数据库在每次真实写入前生成的相邻恢复备份。
- 任意测试或审查失败时不提交，先在同一阶段修复并重跑对应验证。

## 真实执行记录（2026-08-20）

- 独立审查第一轮发现并修复：仅含 `.codex/sessions/` 的项目误判、顶层 inline `features` table、TOML 与 cc-switch 确认窗口的过期写入、Claude→Codex 增量初始化遗漏 `AGENTS.md` fallback，以及既有 init/uninstall 测试未隔离用户级 helper。
- 后续审查修复：TOML 校验改用打包的 `@iarna/toml`，不再依赖 Python 3.11+ 的 `tomllib`；Python 绝对路径含 `python3` 时使用边界安全替换；带引号的 TOML key 不被误判为可安全定位的裸键；cc-switch 拒绝、冲突和确认后变化时的人工指引明确指向 `settings.common_config_codex`。
- 阶段范围回归：`pnpm --filter trellis-hgl exec vitest run test/utils/codex-user-config.test.ts test/configurators/shared.test.ts test/commands/init.integration.test.ts test/commands/update.integration.test.ts test/commands/init-uninstall-overdelete.integration.test.ts test/configurators/platforms.test.ts test/templates/codex.test.ts` 通过（7 个文件、265 项）。
- workspace 验证：`pnpm typecheck`、`pnpm build`、`pnpm lint`、`pnpm test -- --reporter=dot` 均通过；全量测试为 Core 272 项通过、CLI 1252 项通过及 3 项既有 skip。OpenCode reader 暂不可用与发布 metadata 可见性重试均为既有警告，未改变退出状态。
- 最终打包验证：从最终源码生成 CLI/Core beta.31 tgz，在 `C:\Users\asus\AppData\Local\Temp\trellis-phase4-pack.KJP4Lu\consumer` 以本地包安装并执行 `init --codex --yes`。验证 `.agents/skills` 下的两个 skill、`.codex/agents/trellis-check.toml` 和 `AGENTS.md` 存在；`.codex/skills` 不存在；`AGENTS.md` 有 `$trellis-start` fallback；tarball 不含退休的 Codex skills 目录或开发机绝对路径。
- 最终第 9 轮 spec-review、code-review、code-architecture-review 均为 PASS；审查确认没有第二套 Codex skill source、无调用方抽象、推测性 review/worktree 实现或过度兼容层。
- 阶段 4 的 7 个 `edit-backup-guard` 备份批次均已 finalize。
