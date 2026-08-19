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

- [ ] build、test、typecheck、lint、pack、tarball 清单和 clean-install consumer E2E 通过。
- [ ] 新环境不含源码或 `matt-skills-main` 时仍能正常工作。
