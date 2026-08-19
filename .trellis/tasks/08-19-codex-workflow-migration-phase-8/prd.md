# Codex 工作流无缝迁移 - 阶段 8：npm tarball 与干净环境 E2E

## 目标

验证发布包而非源码目录能够完成最小双端工作流。

## 需求

- release preflight 验证 tarball 包含 templates、skills、agents、hooks、workflow 和 migration manifests。
- 从 CLI/core tgz 在干净临时目录安装，运行三种 init、双向增量启用、update/migrate。
- 执行最小 task -> planning -> strategy -> implement -> reviews -> merge-review -> final validation 流程。
- 检查开发机绝对路径、Windows/Linux 路径和换行符。

## 验收标准

- [ ] build、test、typecheck、lint、pack、tarball 清单和 clean-install consumer E2E 通过。
- [ ] 新环境不含源码或 `matt-skills-main` 时仍能正常工作。
