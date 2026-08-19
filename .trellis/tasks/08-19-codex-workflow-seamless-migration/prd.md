# Codex 工作流无缝迁移

## 目标

在不删除、不弱化既有 Trellis 或 Claude Code 能力的前提下，将当前工作流演进为 Claude Code 和 Codex 的一等双端工作流。共享状态只存放在 `.trellis/`，平台差异限制在入口、skills、hooks 与 provider 适配层。

## 需求

- `trellis init` 和 `trellis update` 支持 Claude-only、Codex-only、Claude+Codex，以及两个方向的增量启用；不破坏用户入口文件和运行时数据。
- `CLAUDE.md` 与 `AGENTS.md` 的宿主无关规则来自同一共享模板源；任一宿主不能依赖读取另一宿主的入口文件。
- task record 必须能结构化记录宿主、主会话或 subagent 模式、worktree 选择与实际路径、默认或 TDD 流程、review gate 的选择和执行状态，并保持旧任务可读。
- 每个任务只允许一个事实工作目录。新建双端任务沿用已锁定的默认路径 `./.trellis/trellis-worktrees/<task-dir-name>`；兼容旧 `.claude/worktree`、当前 checkout 和用户指定 worktree。
- Codex 获得与 Claude 语义一致的 research、implement、check、spec-review、code-review、code-architecture-review、merge-review 能力；独立 review 为只读且不替代 `trellis-check`。
- skills、模板、agents、hooks 与 migration manifest 必须包含在 npm tarball 中，且运行时不依赖 `D:\Trellis\matt-skills-main` 或任何开发机绝对路径。
- 当前协调会话只负责任务拆分、需求对齐、调度、验收收敛和 Git 提交；各阶段的实现、测试和独立 review 由明确边界的执行 agent 完成。
- 每个已完成阶段至少有一个独立 Git 提交；只有完成本阶段验收和所选 review gate 后才能归档或推进。
- 所有阶段采用最小必要实现：只实现已确认需求；除非已有调用路径或 PRD 明确证明必要，不增加面向假设场景的抽象、配置、兼容分支、兜底逻辑或重复校验。验收和架构审查必须删除或说明这类复杂度的必要性。

## 约束与已确认取舍

- 保持当前 npm 包名与发布契约，不做顺带改名。
- review gate 为任务级显式选择；已启用 gate 按 spec -> code -> architecture 执行，merge-review 在最终合并后、全量验证前执行。Codex inline 不得静默跳过已选 gate。
- Codex hooks 依赖用户级能力和宿主审批；缺失时必须有 `AGENTS.md` 与 `trellis-start` 降级路径。对用户级 `cc-switch` 数据库或 `~/.codex/config.toml` 的实际修改须在阶段 4 获得单独授权。
- 本迁移父任务复用当前 checkout `D:\Trellis\Trellis-0.6.0-beta.17`，分支为 `task/codex-workflow-seamless-migration`，目标分支为 `main`。
- 2026-08-19 用户确认：按阶段 1 至阶段 9 的依赖顺序推进；每个阶段独立测试、三重 review 和 Git 提交。
- 2026-08-19 用户确认：阶段 4 的用户级 cc-switch/Codex 配置采用“每次显式确认后自动写入”。命令必须先展示目标文件、拟写入项和备份方式；拒绝或无权限时只报告可执行的手动降级步骤。

## 验收标准

- [ ] 三种 fresh init、两个方向的增量启用、重复 init/update 和 legacy Codex upgrade 均由集成测试覆盖。
- [ ] 共享入口规则、task 状态、skills、review 合同和唯一 worktree 规则在两个宿主下语义一致。
- [ ] 打包后的 CLI/core tgz 能在无源码、无 `matt-skills-main` 的干净目录完成最小双端工作流。
- [ ] 最终集成完成 spec-review、code-review、code-architecture-review、merge-review、build、test、typecheck、lint、pack 和 clean-install E2E。
- [ ] 十个阶段均具有独立验收证据、中文交接记录和对应 Git 提交。

## 阶段任务

1. 阶段 0：基线与迁移契约。
2. 阶段 1：结构化任务状态与跨会话恢复。
3. 阶段 2：共享 CLAUDE.md/AGENTS.md 入口模板。
4. 阶段 3：init/update 平台组合和双向增量启用。
5. 阶段 4：Codex skills、hooks 与启动可靠性。
6. 阶段 5：Codex review agents 和共享 review 合同。
7. 阶段 6：唯一 worktree 与跨代理复用。
8. 阶段 7：历史项目 update/migration 兼容。
9. 阶段 8：npm tarball、干净环境 E2E 与发布验收。
10. 阶段 9：最终集成和合并后验收。
