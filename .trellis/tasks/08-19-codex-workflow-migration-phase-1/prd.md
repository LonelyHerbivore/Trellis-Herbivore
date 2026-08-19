# Codex 工作流无缝迁移 - 阶段 1：结构化任务状态与跨会话恢复

## 目标

将宿主、执行模式、worktree、开发流程和 review 状态从自由文本提升为平台无关、可校验、可恢复的 task 元数据。

## 需求

- 扩展 Core task record、TypeScript schema 与 Python writer/validate。
- 记录宿主、主会话/subagent、worktree 选择和实际路径、default/TDD、`explicit-selection-v1`、enabled/disabled review gates、各 gate 状态、尝试次数和报告路径。
- 旧 task 继续作为 legacy task 可读，不强制迁移。

## 已确认合同

- 新结构为可选且版本化的 task 顶层工作流状态。缺失时按 `legacy` 读取，不能因升级而拒绝既有 `task.json`。
- 新任务先记录未选择状态；用户完成策略选择后写入 `explicit-selection-v1`。这不是默认推断，缺少任一必选选择时不得标记为已显式选择。
- `worktree_path` 保持现有顶层字段作为唯一实际目录；结构化状态中的 worktree 选择必须与它一致，不能维护第二个路径副本。
- review gates 固定为 `spec-review`、`code-review`、`code-architecture-review`、`merge-review`。每一个 gate 必须显式位于 enabled 或 disabled 列表之一；已启用 gate 才能具有 pending/PASS/FAIL/skipped、attempts 和 report path 状态。
- 阶段 1 只建立数据合同、读写和验证，不修改阶段 2 以后的入口、init/update、agent prompt、review 执行或 worktree 创建行为。

## 验收标准

- [ ] 新旧 fixture 读写和 schema 测试通过。
- [ ] CLI 生命周期与 Core record 一致。
- [ ] 非法 gate 依赖、缺少选择列表和 worktree 不一致均被拒绝。
- [ ] Claude 与 Codex 对同一 task 的恢复语义一致。
