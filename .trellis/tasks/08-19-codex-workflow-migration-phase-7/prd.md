# Codex 工作流无缝迁移 - 阶段 7：历史项目 update/migration 兼容

## 目标

使旧 Claude、旧 Codex 和混合项目可安全升级到双端工作流。

## 需求

- 覆盖旧 Codex `.agents/skills`、agent rename、skill path、hook、dispatch mode 与新增 review agents 的迁移。
- 覆盖 pristine、用户修改、目标存在、`--migrate`、dry-run、force、skipAll、backup 与失败恢复。
- non-native workflow 继续遵守 hash 契约，其他工具共享 `.agents/skills` 不得误装 Codex。

## 通用工程约束

- 只为已确认的阶段需求增加内容；除非已有调用路径或 PRD 明确证明必要，不增加面向假设场景的抽象、配置、兼容分支、兜底逻辑或重复校验。
- 阶段验收与架构审查必须核查新增代码和测试是否直接支撑需求；发现未被需求或实际调用证明的复杂度时，删除或记录其必要性。

## 验收标准

- [ ] 使用版本跳跃 fixture 验证迁移，而非只断言 manifest 或源码文本。
- [ ] 用户入口、agent、skill 与运行时数据在成功和失败路径中均被保护。
- [ ] mixed Claude+Codex update 顺序和 ownership 可验证。
