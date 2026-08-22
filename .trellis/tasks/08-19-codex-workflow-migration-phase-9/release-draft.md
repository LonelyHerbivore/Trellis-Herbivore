# 阶段 9 发布草稿

> 状态：已完成发布归档记录。版本为 `0.6.0-beta.32`，本记录基于真实差异 `v0.6.0-beta.31..HEAD` 生成；GitHub tag、GitHub Release 和 npm 发布均已完成。

## GitHub Release 中文标题

`Trellis 0.6.0-beta.32：Claude Code 与 Codex 双端工作流无缝迁移`

## GitHub Release 中文正文草稿

### 相较 `v0.6.0-beta.31` 的新增内容

- 将 Claude Code 与 Codex 纳入同一套平台无关的 Trellis 工作流：共享 task、PRD、workflow、开发策略、TDD 选择、review 闸门和任务状态。
- `trellis init` / `trellis update` 支持 Claude-only、Codex-only、Claude + Codex，以及单平台项目增量开启另一平台；保留用户已有 `CLAUDE.md`、`AGENTS.md` 和自定义内容。
- 增加 Codex 项目入口、hooks、review agent 配置和项目级 skills 生成路径；Claude 侧继续保留原有入口和能力。
- 统一任务唯一 worktree 语义，记录实际工作目录并让主 agent、实现 agent、测试 agent 和 review agent 复用同一目录。
- 将需求对齐、subagent 编排、spec-review、code-review、code-architecture-review 和最终 merge-review 纳入可持久化任务产物。
- 扩展 task schema、workflow 状态和迁移脚本，覆盖历史项目 update/migration、失败恢复、任务归档、worktree 同步以及最小双端工作流。
- 增加发布预检、双包版本锁定、packed CLI 精确依赖检查、tarball 清单检查和 clean-install consumer E2E。

### 修复与兼容性

- 修复 `pack-publish-artifacts` 在源码 checkout 根目录创建临时目录的问题，改用系统临时目录，避免发布预检污染工作区或误入提交。
- 新任务优先使用平台无关的 `.trellis/trellis-worktrees/<task-dir-name>`。
- update/migration 通过受保护文件和失败恢复测试，避免增量启用平台时覆盖用户入口文件和自定义配置。
- tarball 运行时资产自包含，不依赖 `D:\Trellis\matt-skills-main\...`、源码 checkout 或开发机绝对路径。

### Claude Code / Codex 双端变化

- Claude Code 继续生成和维护 `CLAUDE.md`、Claude hooks 与 Claude 侧 agent 配置。
- Codex 生成 `AGENTS.md`、Codex hooks、Codex review agent TOML，并通过项目级 `.agents/skills/` 暴露可复用能力。
- 平台无关的流程正文继续集中在 `.trellis/` 和共享模板中，避免复制出两套 task/workflow 状态。

### update/migration、tarball 与 clean-install E2E

- `trellis update` 已覆盖单平台到双平台的增量迁移、重复执行幂等性、用户文件保护和失败恢复。
- CLI/Core tarball 均通过 manifest 检查；CLI tarball 包含 Claude/Codex agent、hooks、共享 skills、Trellis 脚本、workflow 与 migration manifest。
- clean-install consumer E2E 在没有源码目录和 `matt-skills-main` 的干净消费者目录中安装本地 tarball，并验证三种 init、双向增量、update/migration、task/workflow/review 最小链路。

### 测试与验证

- `pnpm typecheck`、`pnpm build`、`pnpm lint`：通过。
- `pnpm test -- --reporter=dot`：通过；Core 16 个文件 / 272 项，CLI 45 个文件 / 1301 项，1 个文件 / 3 项跳过。
- release-preflight 定向测试：11 项通过。
- `verify-packed-cli`、`verify-tarball-manifest`、`pack-publish-artifacts`、Python `compileall`、阶段 9 `task.py validate`、`git diff --check`：通过。
- clean-install consumer E2E：通过。
- `verify-npm --package all`：只读确认 `0.6.0-beta.32` 的 CLI/Core 均在 npm `latest` 可见。

### 已知限制与未完成事项

- 本地全局安装验收使用隔离 prefix 执行 `npm install -g` 语义测试，未写入用户系统级全局 npm 目录；真实系统级安装仍由用户环境决定。
- 本地完整验证主机为 Windows；GitHub Actions 的 Ubuntu 发布运行已通过。
- 本父任务没有遗留发布阻塞或未完成交付；阶段 10 未启动。

### 破坏性变更

未发现有意的 CLI/API 破坏性变更。Codex 模板和任务状态的新增/迁移通过 `trellis update` 路径兼容旧项目；用户自定义入口文件不应被覆盖。

## npm 中文发布摘要

`trellis-hgl` 与 `trellis-hgl-core` 已同步发布 `0.6.0-beta.32`。本版本完成 Claude Code + Codex 双端工作流迁移，加入 Codex 入口/hooks/review agent、共享 task/workflow/review 状态、唯一 worktree 记录、历史项目 update/migration、tarball 自包含检查和 clean-install E2E。CLI 打包后将 Core 依赖锁定为同版本；GitHub Actions 已完成两个包的发布并验证 `latest`。

## 已执行的 GitHub / npm 命令记录

以下命令和等价的 GitHub Actions 流程已在用户确认后执行；本节保留发布过程和发布后核验记录：

```bash
# 1. 发布窗口内已同步两包版本（beta.31 -> beta.32）
node packages/cli/scripts/bump-versions.js beta
node packages/cli/scripts/release-preflight.js check-versions

# 2. 发布前本地门禁
pnpm typecheck
pnpm build
pnpm lint
pnpm test -- --reporter=dot
node packages/cli/scripts/release-preflight.js verify-packed-cli
node packages/cli/scripts/release-preflight.js pack-publish-artifacts
node packages/cli/scripts/release-preflight.js verify-tarball-manifest

# 3. 已提交 bump 后的两包版本并创建匹配 tag
git add packages/cli/package.json packages/core/package.json
git commit -m "0.6.0-beta.32"
git tag v0.6.0-beta.32

# 4. 已推送 main 和 tag，触发 .github/workflows/publish.yml
git push origin HEAD --tags

# 5. 已创建 GitHub Release（正文使用本文件上方草稿）
gh release create v0.6.0-beta.32 --title "Trellis 0.6.0-beta.32：Claude Code 与 Codex 双端工作流无缝迁移" --notes-file .trellis/tasks/08-19-codex-workflow-migration-phase-9/release-draft.md

# 6. 已执行发布后只读核验；官方 npm publish 由 GitHub Actions 执行
node packages/cli/scripts/release-preflight.js verify-published-cli-manifest
node packages/cli/scripts/release-preflight.js verify-npm --package all
npm view trellis-hgl@0.6.0-beta.32 version dist-tags --json --registry=https://registry.npmjs.org/
npm view trellis-hgl-core@0.6.0-beta.32 version dist-tags --json --registry=https://registry.npmjs.org/
```

官方流程不建议在本机直接运行 `npm publish`；如 CI 故障，先检查 GitHub Actions 和 registry 可见性，再按发布规范处理，不绕过版本锁定和 provenance 约束。
