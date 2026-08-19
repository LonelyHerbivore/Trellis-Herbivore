# 阶段 1 执行计划

## 实施前核验

1. 读取本阶段 PRD/设计、父任务交接、Core SDK 和 Python script 规范。
2. 复核 `TrellisTaskRecord` 当前 24 字段严格解析、`writeTaskRecord()` 的 unknown-field 保留规则，以及 Python `cmd_create` 的 task JSON 写入点。
3. 对拟修改的 Core 和 CLI 符号完成影响分析；当前环境未提供 GitNexus 时，在交接记录明确该限制。

## 执行任务

1. 由 Core 实施 agent 新增版本化状态的 TypeScript 类型、解析、默认化和纯验证，保持旧 record load/write 兼容。
2. 由 CLI script 实施 agent 同步 Python create/read/validate，严格按同一 JSON 合同返回可行动错误。
3. 由测试 agent 新增/扩展 Core task fixture 与 CLI 模板脚本集成覆盖；不得把 contract 测试写成源码正则。
4. 协调会话收敛文件边界，确认新字段没有被写入自由 `meta`，且 `worktree_path` 没有重复路径来源。

## 验证与 review

```bash
pnpm --filter trellis-hgl-core test -- test/task/schema.test.ts test/task/records.test.ts
pnpm --filter trellis-hgl test -- <阶段 1 相关测试文件>
pnpm typecheck
pnpm lint
pnpm test
```

顺序执行 spec-review、code-review、code-architecture-review。所有已启用 gate 通过后更新 `handoff.md`，提交 `feat(trellis): complete codex workflow migration phase 1`。merge-review 留给阶段 9 的最终集成，不将该保留解释为跳过。

## 回滚点

若新状态让 legacy record、Python script 或现有 init/update fixture 无法读取，停止并回退本阶段未提交改动；已提交后以追加修复提交处理。不得批量重写历史 task JSON 作为临时补救。
