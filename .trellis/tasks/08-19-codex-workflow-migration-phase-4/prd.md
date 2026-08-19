# Codex 工作流无缝迁移 - 阶段 4：skills、hooks 与启动可靠性

## 目标

修复 Codex-specific skill 资源路径，建立 hooks 不可用时仍可启动的明确降级路径。

## 需求

- 修复 `codex-skills` 与实际 `skills` 目录不一致，统一 source、dist 与 tarball 资源映射。
- 明确 `.agents/skills` 和 `.codex` 的安装职责，消除重复语义。
- 增加 cc-switch 优先、Codex config fallback 的 `default_mode_request_user_input` 检查/补齐逻辑，保留用户其他设置。
- 检测 hooks 前置条件，hooks 不可用时由 `AGENTS.md` 和 `trellis-start` 降级。

## 验收标准

- [ ] skills 在 source、dist、tarball 和目标项目均可达。
- [ ] 用户配置缺失、正确、含其他 features、格式异常和无权限均有测试。
- [ ] 用户级配置实际写入前获得单独授权，不以项目级测试替代授权。
