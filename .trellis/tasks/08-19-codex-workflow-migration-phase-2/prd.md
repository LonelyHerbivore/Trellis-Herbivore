# Codex 工作流无缝迁移 - 阶段 2：共享入口模板

## 目标

让 `CLAUDE.md` 与 `AGENTS.md` 从同一共享规则源渲染，并支持非破坏式 init/update。

## 需求

- 抽取宿主无关规则共享模板，平台命令、skills、hooks 与交互能力保留在适配层。
- 支持 pristine、用户修改 managed block、无 marker 用户文件的生成与更新路径。
- 保留两个入口 managed block 外的用户内容。

## 验收标准

- [ ] Claude-only、Codex-only、双端入口生成正确。
- [ ] 用户外部内容和既有冲突策略不被破坏。
- [ ] 两个入口共享片段有来源一致性测试。
