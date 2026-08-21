# Codex 工作流无缝迁移 - 阶段 5：review agents 与共享合同

## 目标

为 Codex 增加独立、只读的 review agents，并让两个宿主共享 review 合同。

## 需求

- 新增 spec-review、code-review、code-architecture-review、merge-review 四个 Codex agent。
- 每个 agent 从 task record 读取 worktree 和 gate 选择，输出统一 PASS/FAIL、证据、阻塞项和下一步，并落盘至 `.trellis/`。
- Claude Code 与 Codex 对同一 `task.json.workflow` 使用相同的 gate 选择、legacy/invalid 边界和报告合同；只保留各宿主的调用与上下文注入差异。
- shared workflow 按 spec -> code -> architecture 顺序执行 enabled gate；FAIL 由主 agent 修复并重跑当前 gate；inline 不隐式跳过。

## 通用工程约束

- 只为已确认的阶段需求增加内容；除非已有调用路径或 PRD 明确证明必要，不增加面向假设场景的抽象、配置、兼容分支、兜底逻辑或重复校验。
- 阶段验收与架构审查必须核查新增代码和测试是否直接支撑需求；发现未被需求或实际调用证明的复杂度时，删除或记录其必要性。

## 验收标准

- [x] inventory、权限、prelude、递归防护和输出合同测试通过。
- [x] enabled、disabled、legacy 与非法合同组合均覆盖。
- [x] Claude/Codex 对同一 fixture 的 gate 顺序一致。
