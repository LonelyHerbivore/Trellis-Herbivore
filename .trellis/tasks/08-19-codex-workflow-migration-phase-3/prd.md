# Codex 工作流无缝迁移 - 阶段 3：init/update 平台组合

## 目标

将双端初始化和增量补齐变成可验证、可恢复且不破坏用户文件的正式路径。

## 需求

- 覆盖 Claude-only、Codex-only、Claude+Codex、Claude -> Codex、Codex -> Claude。
- 覆盖重复 init、`--force`、`--skip-existing`、partial install recovery、hash 合并与 update 收集。
- 保留 `needsCodexUpgrade()` 的 Codex-only marker，禁止仅凭 `.agents/skills` 误判。

## 通用工程约束

- 只为已确认的阶段需求增加内容；除非已有调用路径或 PRD 明确证明必要，不增加面向假设场景的抽象、配置、兼容分支、兜底逻辑或重复校验。
- 阶段验收与架构审查必须核查新增代码和测试是否直接支撑需求；发现未被需求或实际调用证明的复杂度时，删除或记录其必要性。

## 验收标准

- [ ] 五种场景和重复操作均有集成测试。
- [ ] 只保留一份 `.trellis`，既有用户内容和运行数据不被接管或覆盖。
- [ ] update 能处理两个宿主的已配置模板。
