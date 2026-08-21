# 阶段 5 实施记录与执行计划

## 执行顺序

1. 读取阶段 5 PRD、CLI template/configurator/script/test 规范、阶段 4 交接和当前 task contract。
2. 为将修改的既有源码、模板和测试启动一个独立 `edit-backup-guard` 批次；不将 `.gitignore` 放入批次或暂存范围。
3. 新增四个 Codex 只读 review TOML，并将既有 Claude review 模板同步到相同 task-record/报告合同；所有 agent 必须先读取 task record 和实际 worktree，Claude hook/dispatch 行为不变。
4. 扩展现有 pull-based `check` prelude 的 review agent 名称识别；仅对 review 名称在 check context 前执行 task-record-first 步骤，`trellis-implement` 与 `trellis-check` 保持原有行为，使 init 与 update/hash 渲染路径一致。
5. 将 workflow 的 review gate 文案收敛为宿主无关合同：enabled 顺序、disabled/legacy/invalid 行为、main-session report 落盘、FAIL 重跑、三次连续 FAIL 升级，以及 inline 不跳过；所有 planning/start/implement/check prompt 以 `task.worktree_path` 作为唯一实际目录。
6. 补充 inventory、权限、prelude、递归防护、输出合同、init/update 生成物，以及对同一 shared workflow 合同的 Claude/Codex 模板行为测试。
7. 依次执行 spec-review、code-review、code-architecture-review；任一 FAIL 由主会话修复并重新运行当前 gate，当前 gate PASS 后才进入下一道。
8. 运行阶段范围测试、`pnpm typecheck`、`pnpm build`、`pnpm lint`、全量测试；更新中文交接和 task 状态，finalize 备份后单独提交。

## 预期修改面

- `packages/cli/src/templates/codex/agents/` 四个新 review agent
- `packages/cli/src/templates/claude/agents/` 四个既有 review agent 的 task-record/报告合同
- `packages/cli/src/configurators/shared.ts`
- `packages/cli/src/templates/trellis/workflow.md` 与 native marketplace 镜像
- `packages/cli/src/templates/common/{commands/start,skills/brainstorm,skills/before-dev}.md`
- `packages/cli/src/templates/claude/agents/trellis-{implement,check}.md`
- 临近的 Codex/template/configurator/workflow/init-update 回归测试
- 阶段 5 task 文档与交接记录

## 不在本阶段的内容

- 不新增 task schema 字段、review report CLI、review 注册表、review 专属 JSONL。
- 不改变 `trellis-check` 的 workspace-write/self-fix 行为。
- 不创建、嵌套、同步或复用 worktree；不修改 worktree sync/snapshot/runtime bundle 或 hook 行为。本阶段仅使生成 prompt 服从已记录的 `task.worktree_path`，这些运行时能力属于阶段 6。
- 不修改 Claude hook、dispatch 或 worktree 行为；Claude review agent 仅为共享 task-record/报告合同作最小文本同步。

## 验证命令

```text
pnpm --filter trellis-hgl exec vitest run <阶段 5 相关测试文件>
pnpm typecheck
pnpm build
pnpm lint
pnpm test -- --reporter=dot
git diff --check
```

## 审查标准

- spec-review：每个 PRD 条目都有执行式证据；review agent 只读，报告由主会话写入 `.trellis/`，没有权限语义混淆；共享 workflow 是唯一 dispatch 合同，不保留没有生产调用方的 gate-plan 抽象。
- code-review：四个 agent 的 active-task、task record、worktree、enabled/legacy/invalid、报告格式和重跑顺序正确；planning/start/implement/check 也不覆盖 `task.worktree_path`；init/update 能安装与跟踪它们。
- code-architecture-review：没有第二套 review 合同、report writer、context bucket 或 agent registry；没有提前实现阶段 6。

## 回滚点

- 本阶段 `.codex-backups/<batch>/originals` 与 `patches`。
- 任一测试或审查失败时不提交，先在同一阶段修复并重跑相应验证。

## 真实执行记录（2026-08-21）

- 已新增四个 Codex 只读 review TOML；它们复用现有 check context prelude，并在读取 JSONL 前以 task record 作为唯一 gate/worktree 来源。
- 已收敛 Claude/Codex 共享 review 合同：explicit selection 的核心 gate 顺序固定为 spec -> code -> architecture，legacy、invalid、disabled、PASS/FAIL 重跑和主会话报告落盘行为保持一致；merge-review 位于最终合并后、全量验证前。
- 已消除生成 prompt 对静态 worktree 路径的覆盖，planning/start/implement/check/review 都以 task.worktree_path 为唯一实际工作目录；没有实现阶段 6 的 create/sync/reuse 运行时。
- 2026-08-21：阶段范围 Vitest 7 文件通过（481 tests）；pnpm typecheck、pnpm build、pnpm lint、pnpm test -- --reporter=dot 和 git diff --check 全部通过。
- 独立 spec-review、code-review、code-architecture-review 和 merge-review 均为 PASS。merge-review 未发现阶段 6 越界或缺失的生产调用路径。
