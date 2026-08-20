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

- [x] skills 在 source、dist、tarball 和目标项目均可达。2026-08-20 已从最终源码重新 build/pack；验证包位于 `C:\Users\asus\AppData\Local\Temp\trellis-phase4-pack.KJP4Lu\packages\`（CLI/Core beta.31 tgz）。隔离 consumer 以本地 tgz 安装后执行 `init --codex --yes` 成功，生成 `.agents/skills/trellis-start/SKILL.md`、`.agents/skills/trellis-break-loop/SKILL.md`、`.codex/agents/trellis-check.toml` 与 `AGENTS.md`，未生成 `.codex/skills/`。CLI tarball 含 common `start.md`、common `break-loop.md` 与 `codex-user-config.js`，且不含 `templates/codex/skills/` 或开发机 `matt-skills-main` 路径；生成的 `trellis-start` 包含 Switch Gate，不含阶段 5/6 的 review/worktree 内容。
- [x] 用户配置缺失、正确、含其他 features、格式异常、内联 `features` table、带引号目标键、确认期间变更和无权限均有测试；cc-switch 优先、fallback、拒绝、非交互、dry-run、读写失败均有覆盖。cc-switch 路径的失败/拒绝指引明确指向其 `settings.common_config_codex`，不会把 SQLite 数据库描述为 TOML 文件。
- [x] hooks 不可用或尚未批准时，Codex 新建项目和 Claude→Codex 增量初始化的 `AGENTS.md` 都提供 `$trellis-start` 降级入口；无 Trellis managed block 的用户文件保持不覆盖，并给出手工入口提示。
- [x] 仅含 `.codex/sessions/` 等 Codex 运行时数据不会被识别为 Trellis Codex 配置、不会触发用户级写入或被 update 接管；Trellis config 签名或 `trellis-*.toml` agent 标记可恢复识别。
- [x] 用户已于 2026-08-19 授权：`trellis init/update` 每次展示目标、拟写入项和备份方式并获得显式确认后，可更新用户级 cc-switch 数据库或 `~/.codex/config.toml`；拒绝或失败时降级为提示。
