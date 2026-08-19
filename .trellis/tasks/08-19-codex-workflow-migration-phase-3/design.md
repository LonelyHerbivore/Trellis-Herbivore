# 阶段 3 设计：init/update 平台组合

## 范围与边界

本阶段验证并修正 Claude / Codex 的 fresh、增量与恢复安装路径，确保平台组合
不会丢失已存在平台的 template hash，也不会接管用户运行数据。本阶段不新增平台、
迁移 manifest、Codex hooks、skills、review agent 或 worktree 逻辑。

## 现状与问题

`handleReinit()` 的“添加平台”分支已经以 `merge: true` 写入 hash，能保留旧平台。
但已有 `.trellis/` 时指定 `--force` 或 `--skip-existing` 会进入完整 init 分支；该分支
此前以替换方式初始化 hash。于是一个已有 Claude 项目以 `--skip-existing --codex` 修复
缺失 Codex 文件后，未实际重写的 Claude hash 会从 manifest 消失，后续 update 会把它
错误分类为用户修改。

## 设计决策

1. 仅在非首次 init 的完整路径中启用已有 `initializeHashes(..., { merge: true })` 能力。
   fresh init 继续从空 manifest 建立 ownership，避免把预先存在的用户文件误纳入管理。
2. `--skip-existing` 继续只补缺失文件；`--force` 继续覆盖本次选择的平台模板。二者均
   保留没有被本次写入的平台 hash，以便 update 继续识别其 pristine 状态。
3. `getConfiguredPlatforms()` 与 `needsCodexUpgrade()` 不改动：Codex 只能由 `.codex/`
   或 legacy 的两条 Codex 专属 command-skill hash 标记识别，不能凭共享
   `.agents/skills/` 推断。
4. 测试复用现有 init/update 集成 fixture，不建立平台组合框架或新的测试 helper 层。

## 验收映射

- fresh Claude-only、Codex-only、Claude + Codex 继续由现有初始化测试覆盖。
- Claude -> Codex、Codex -> Claude 均验证原平台文件与 hash 保留、新平台文件和 hash
  增加，且 `.trellis` 只有一份。
- partial recovery 使用 `--skip-existing --codex` 补回缺失 Codex 模板，并验证原 Claude
  hash 不丢失。
- `--force --codex` 不会抹掉未选择 Claude 的 manifest ownership。
- 双端 update 同时收集 Claude/Codex 模板，且运行时数据保持不变。
- Gemini 共享 skills 的 update 不创建 `.codex/`，证明 `needsCodexUpgrade()` 没有误判。

## 不采用的方案

- 不为所有平台组合建立注册表或状态文件；当前调用链和平台 registry 已提供所需信息。
- 不把 `.agents/skills/` 当作 Codex marker，也不为 partial recovery 新增独立命令。
- 不在 `initializeHashes()` 内猜测调用语义；由 init 的已知 `isFirstInit` 边界决定是否合并。
