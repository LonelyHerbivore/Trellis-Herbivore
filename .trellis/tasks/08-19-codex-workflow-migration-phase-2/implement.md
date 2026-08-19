# 阶段 2 实施清单：共享入口模板

## 执行步骤

1. 建立共享入口正文模板，并从 markdown 模板模块同时导出 Claude/Codex 两个
   渲染值。
2. 扩展根文件常量与 init 根文件写入：首次 init 和增量平台 init 都在选择 Claude
   时写入 `CLAUDE.md`，同时保留 `AGENTS.md` 的既有行为。
3. 在 update 中复用现有 marker 替换/追加逻辑处理两种入口；Claude 未配置时不得
   主动创建 `CLAUDE.md`。
4. 扩展 hash fallback、update backup 和 manifest prune，使 managed Claude
   入口可更新、可备份且不把用户文件纳入 ownership。
5. 在现有 init/update/manifest-prune 集成测试中覆盖阶段验收矩阵，不新增只验证
   字符串或实现细节的测试。

## 验证顺序

```bash
pnpm --filter trellis-hgl test -- test/commands/init.integration.test.ts
pnpm --filter trellis-hgl test -- test/commands/update.integration.test.ts
pnpm --filter trellis-hgl test -- test/utils/manifest-prune.test.ts
pnpm typecheck
pnpm build
pnpm test
pnpm lint
git diff --check
```

## Review 闸门

- spec-review：逐项核对入口生成、用户外部内容保护、共享来源一致性与增量 init。
- code-review：检查 Claude/Codex 选择条件、hash/backup/manifest 路径和现有冲突
  策略未被绕过。
- code-architecture-review：确认没有重复入口正文、无调用方的注册抽象、额外配置、
  推测性兼容分支或重复校验。
- merge-review：留给阶段 9 最终集成，不将其视为本阶段已跳过。

## 回滚点

本阶段只涉及模板、入口生命周期和测试；若验证失败，可只回退本阶段提交，不影响
阶段 1 的 task workflow 数据合同。
