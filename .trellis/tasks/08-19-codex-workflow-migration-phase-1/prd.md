# Codex 工作流无缝迁移 - 阶段 1：结构化任务状态与跨会话恢复

## 目标

将宿主、执行模式、worktree、开发流程和 review 状态从自由文本提升为平台无关、可校验、可恢复的 task 元数据。

## 需求

- 扩展 Core task record、TypeScript schema 与 Python writer/validate。
- 记录宿主、主会话/subagent、worktree 选择和实际路径、default/TDD、`explicit-selection-v1`、enabled/disabled review gates、各 gate 状态、尝试次数和报告路径。
- 旧 task 继续作为 legacy task 可读，不强制迁移。

## 验收标准

- [ ] 新旧 fixture 读写和 schema 测试通过。
- [ ] CLI 生命周期与 Core record 一致。
- [ ] 非法 gate 依赖、缺少选择列表和 worktree 不一致均被拒绝。
- [ ] Claude 与 Codex 对同一 task 的恢复语义一致。
