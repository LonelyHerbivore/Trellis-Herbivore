# Codex 工作流无缝迁移 - 阶段 8：npm tarball 与干净环境 E2E

## 目标

验证发布包而非源码目录能够完成最小双端工作流。

## 需求

- release preflight 验证 tarball 包含 templates、skills、agents、hooks、workflow 和 migration manifests。
- 从 CLI/core tgz 在干净临时目录安装，运行三种 init、双向增量启用、update/migrate。
- 执行最小 task -> planning -> strategy -> implement -> reviews -> merge-review -> final validation 流程。
- 检查开发机绝对路径、Windows/Linux 路径和换行符。

## 通用工程约束

- 只为已确认的阶段需求增加内容；除非已有调用路径或 PRD 明确证明必要，不增加面向假设场景的抽象、配置、兼容分支、兜底逻辑或重复校验。
- 阶段验收与架构审查必须核查新增代码和测试是否直接支撑需求；发现未被需求或实际调用证明的复杂度时，删除或记录其必要性。

## 验收标准

- [x] build、test、typecheck、lint、pack、tarball 清单和 clean-install consumer E2E 通过。
- [x] 新环境不含源码或 `matt-skills-main` 时仍能正常工作。

## 实现边界与假设

- 本阶段只验证已构建的 CLI/core 发布包和干净 consumer；不改变历史项目迁移语义，不启动阶段 9最终集成。
- 打包复用现有 release-preflight、pnpm pack 和 package 文档同步流程；不新增平行发布器。
- consumer 只安装临时目录中的 CLI/core tgz，不引用源码目录、workspace 协议或开发机 skills 路径；测试先将 tgz 复制到 consumer 自有 `artifacts/`，再以相对路径安装并运行。
- clean-install 流程覆盖 Claude-only、Codex-only、Claude + Codex、双向增量启用、update --migrate，以及 task -> planning -> strategy -> implement -> 四道 review -> archive/final validation。
- tarball 清单必须同时包含 templates、skills、agents、hooks、workflow 和 migration manifests，并拒绝开发机绝对路径与 matt-skills-main 泄漏。