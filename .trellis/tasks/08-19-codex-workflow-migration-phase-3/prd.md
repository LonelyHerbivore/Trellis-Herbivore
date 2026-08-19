# Codex 工作流无缝迁移 - 阶段 3：init/update 平台组合

## 目标

将双端初始化和增量补齐变成可验证、可恢复且不破坏用户文件的正式路径。

## 需求

- 覆盖 Claude-only、Codex-only、Claude+Codex、Claude -> Codex、Codex -> Claude。
- 覆盖重复 init、`--force`、`--skip-existing`、partial install recovery、hash 合并与 update 收集。
- 保留 `needsCodexUpgrade()` 的 Codex-only marker，禁止仅凭 `.agents/skills` 误判。

## 验收标准

- [ ] 五种场景和重复操作均有集成测试。
- [ ] 只保留一份 `.trellis`，既有用户内容和运行数据不被接管或覆盖。
- [ ] update 能处理两个宿主的已配置模板。
