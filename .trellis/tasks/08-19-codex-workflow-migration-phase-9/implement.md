# 阶段 9 实施记录

## 集成范围

- 复核阶段 0 至阶段 8 的 task、PRD、设计、实施、交接、提交和 review 证据。
- 修复唯一确认的发布阻塞：`pack-publish-artifacts` 不再在源码 checkout 创建临时目录。
- 为历史阶段补齐 canonical `workflow.review_gates` 元数据和缺失 review report 路径；保留历史证据主体说明。
- 生成最终中文验收报告、GitHub Release 正文、npm 发布摘要和发布后命令记录，统一记录在 `release-draft.md`。

## 实际修改

- `packages/cli/scripts/release-preflight.js`
- `packages/cli/test/commands/release-preflight.test.ts`
- 阶段 0 至 8 task/交接/报告元数据，包含阶段 1 至 3 的阶段 9独立回溯报告与 canonical `workflow.review_gates` 补录
- 阶段 9 task、design、implement、check、reports、handoff

## 验证结果

| 命令或检查 | 结果 |
| --- | --- |
| `pnpm typecheck` | PASS |
| `pnpm build` | PASS |
| `pnpm lint` | PASS |
| `pnpm test -- --reporter=dot` | PASS，Core 16 文件/272 项；CLI 45 文件/1301 项，1 个跳过文件/3 项跳过测试 |
| release-preflight 定向测试 | PASS，11 项 |
| `pack-publish-artifacts` | PASS，CLI/Core tarball 输出到系统临时目录 |
| `verify-packed-cli` | PASS，CLI 精确锁定 Core `0.6.0-beta.32` |
| `verify-tarball-manifest` | PASS，无开发机路径泄漏 |
| clean-install consumer E2E | PASS，阶段 8全量测试中通过 |
| 隔离 prefix 的 `npm install -g` consumer E2E | PASS，安装后执行 Claude init、Codex init、update/migration |
| `verify-npm --package all` | PASS，只读确认 beta.32 已在 npm latest 可见 |
| Python `compileall` | PASS |
| 阶段 9 `task.py validate` | PASS |
| `git diff --check` / `git diff --cached --check` | PASS |

## 评审顺序

1. spec-review：核对总需求、阶段 PRD、发布前置和验证矩阵。
2. code-review：核对发布脚本、打包路径、版本契约、tarball 和 clean-install 行为。
3. code-architecture-review：核对状态模型、职责边界、依赖方向和阶段隔离。
4. merge-review：核对最终暂存边界、受保护路径、统计数字、提交范围和发布锁。

任一 gate 失败都必须回到本阶段修复并重跑后续 gate；未启动阶段 10。

## 已知限制

- 当前主机为 Windows，Linux 矩阵仍由 GitHub Actions 负责。
- 全局安装验收使用隔离 prefix 模拟 `npm install -g`，未写入用户系统全局 npm 目录；正式环境仍由用户/CI决定是否执行真实系统级全局安装。
- npm `0.6.0-beta.32` 已发布，GitHub tag、GitHub Release 和两个 npm 包均已核验通过。
- 当前 `.gitignore`、`%SystemDrive%/` 和 `packages/cli/%SystemDrive%/` 改动来自用户/环境，未纳入阶段 9。
