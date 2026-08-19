# 阶段交接记录

- 阶段：2 - 共享 CLAUDE.md / AGENTS.md 入口模板
- 状态：已完成
- Trellis task：`.trellis/tasks/08-19-codex-workflow-migration-phase-2`
- 实际工作目录：`D:\Trellis\Trellis-0.6.0-beta.17`
- 基础分支：`main`
- 工作分支：`task/codex-workflow-seamless-migration`
- 本阶段目标：让两个项目根入口使用同一份 Trellis managed block，并保留既有 init、update、hash、backup、manifest ownership 语义。

## 已完成需求

- 用 `templates/markdown/root-instructions.md` 作为唯一正文源；`agentsMdContent` 与 `claudeMdContent` 只导出该同一内容，不复制第二份 Markdown。
- fresh init 支持 Claude-only、Codex-only、Claude + Codex：`AGENTS.md` 保持既有始终生成行为，选择 Claude 时生成 `CLAUDE.md`。
- Codex-only 项目执行 `init --claude` 时按既有写入/冲突策略补齐 `CLAUDE.md`，不改写原有 `AGENTS.md`。
- update 对已配置 Claude 项目处理 `CLAUDE.md` 的 managed block；保留 marker 外内容，无 marker 时追加 managed block，用户修改继续走原有冲突策略。
- `CLAUDE.md` 已纳入路径常量、hash 回填、legacy 未跟踪 managed-block 识别、备份和 manifest prune；未配置 Claude 的 Codex-only update 不会新建该文件。

## 主要改动文件

- `packages/cli/src/templates/markdown/root-instructions.md`
- `packages/cli/src/templates/markdown/index.ts`
- `packages/cli/src/commands/init.ts`
- `packages/cli/src/commands/update.ts`
- `packages/cli/src/constants/paths.ts`
- `packages/cli/src/utils/manifest-prune.ts`
- `packages/cli/src/utils/template-hash.ts`
- 相邻 init、update、manifest-prune 集成测试

## 验证结果

| 命令 | 结果 |
| --- | --- |
| `pnpm --filter trellis-hgl test -- test/commands/init.integration.test.ts` | PASS，41 项通过 |
| `pnpm --filter trellis-hgl test -- test/commands/update.integration.test.ts` | PASS，44 项通过 |
| `pnpm --filter trellis-hgl test -- test/utils/manifest-prune.test.ts` | PASS，12 项通过 |
| `pnpm typecheck` | PASS |
| `pnpm build` | PASS，CLI 模板复制到 dist |
| `pnpm test -- --reporter=dot` | PASS，Core 272 项通过；CLI 1206 项通过、3 项既有跳过 |
| `pnpm lint` | PASS |
| `git diff --check` | PASS，仅 Windows CRLF 提示 |

完整测试继续输出既有 OpenCode reader 暂不可用警告，但所有测试退出状态为 0。

## Review 与范围核查

- spec-review：PASS。覆盖 Claude-only、Codex-only、双端 init、增量 `init --claude`、managed block 外内容保护、无 marker 追加和共享来源一致性。
- code-review：PASS。复核时发现并修复 `update` 的 legacy 未跟踪模板判断只接受 `AGENTS.md` 的遗漏；现已对共享入口应用同一固定 allowlist，并有双入口执行式测试。其余 init、hash、backup、manifest 调用路径均使用既有机制。
- code-architecture-review：PASS。只新增一份正文、一个必要的私有 root-file 构建函数和两个常量范围的复用；没有入口注册表、新配置、平台私有 task 状态、推测性回退或重复 Markdown。测试用 `it.each` 复用两入口的同构 legacy 用例，未复制测试逻辑。
- 独立 review-agent：本轮派发被运行时子代理预算门禁拒绝，以上三道审查由协调会话完成；未伪称独立 agent 结论。
- merge-review：按总路线图留给阶段 9 最终集成，未当作本阶段已跳过。

## 备份

- 批次：`.codex-backups/20260819-175540-共享入口模板迁移/`
- 已生成所有既有代码/测试文件的 `originals/*.bak` 与 `patches/*.patch`，manifest 状态为 `finalized`。
- 旧 `agents.md` 属于有意删除；其删除 patch 已单独核验。

## 提交列表

- `feat(trellis): complete codex workflow migration phase 2`

## 未解决问题与下一阶段前置条件

- 阶段 3 继续实现五种平台组合与双向增量启用的完整矩阵；本阶段不扩展 init/update 的平台状态探测或历史迁移。
- 阶段 4 负责 Codex skills、hooks 和启动可靠性；阶段 5 至 8 分别处理 review agents、唯一 worktree、历史迁移与 tarball E2E。
- 下一会话先读取根目录迁移说明、本文、阶段 2 `task.json` 与阶段 3 task 产物，并确认当前分支和 Git 状态。
