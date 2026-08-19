# Codex 工作流无缝迁移 - 阶段 4：skills、hooks 与启动可靠性

## 目标

修复 Codex-specific skill 资源路径，建立 hooks 不可用时仍可启动的明确降级路径。

## 需求

- 修复 `codex-skills` 与实际 `skills` 目录不一致，统一 source、dist 与 tarball 资源映射。
- 明确 `.agents/skills` 和 `.codex` 的安装职责，消除重复语义。
- 增加 cc-switch 优先、Codex config fallback 的 `default_mode_request_user_input` 检查/补齐逻辑，保留用户其他设置。
- 检测 hooks 前置条件，hooks 不可用时由 `AGENTS.md` 和 `trellis-start` 降级。

## 通用工程约束

- 只为已确认的阶段需求增加内容；除非已有调用路径或 PRD 明确证明必要，不增加面向假设场景的抽象、配置、兼容分支、兜底逻辑或重复校验。
- 阶段验收与架构审查必须核查新增代码和测试是否直接支撑需求；发现未被需求或实际调用证明的复杂度时，删除或记录其必要性。

## 验收标准

- [ ] skills 在 source、dist、tarball 和目标项目均可达。
- [ ] 用户配置缺失、正确、含其他 features、格式异常和无权限均有测试。
- [x] 用户已于 2026-08-19 授权：`trellis init/update` 每次展示目标、拟写入项和备份方式并获得显式确认后，可更新用户级 cc-switch 数据库或 `~/.codex/config.toml`；拒绝或失败时降级为提示。
