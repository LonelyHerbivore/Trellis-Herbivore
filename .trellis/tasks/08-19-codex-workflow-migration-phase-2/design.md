# 阶段 2 设计：共享入口模板

## 范围与边界

本阶段只让项目根目录的 `CLAUDE.md` 与 `AGENTS.md` 共享同一份 Trellis
managed block，并把该文件纳入现有 init、重复 init、update、hash、备份和
manifest 清理路径。

不在本阶段实现平台组合交互、历史迁移清单、Codex hooks、skills、review agent
或 worktree 行为；这些分别属于后续阶段。`AGENTS.md` 继续保持现有的始终生成
语义，避免改变其他已支持宿主的入口行为。

## 设计决策

1. 新增一份共享入口正文模板，包含完整的 `TRELLIS:START/END` managed block。
   TypeScript 模板模块从这同一文件导出 `agentsMdContent` 和 `claudeMdContent`。
   当前共享规则没有必要的平台差异，因此不额外引入宿主拼接层。
2. `init` 的根文件写入继续复用现有 `writeFile` 和写入记录：始终尝试写入
   `AGENTS.md`；本次选择 Claude 时额外尝试写入 `CLAUDE.md`。重复 init 的
   “增量添加平台”分支也走相同根文件写入，保证 Codex 项目添加 Claude 后能获得
   `CLAUDE.md`，且现有文件仍遵循 skip/force 规则。
3. `update` 把现有仅适用于 `AGENTS.md` 的 managed-block 构建逻辑收敛为一个
   私有函数，参数只包含文件名和当前模板内容。它继续采用既有策略：替换 marker
   内正文并保留外部内容；无 marker 时只追加 managed block；普通冲突仍由既有
   force/skip/create-new 流程决定。Claude 已配置时才将 `CLAUDE.md` 放入更新
   模板集合。
4. `CLAUDE.md` 加入路径常量、根文件备份、legacy hash fallback 和 manifest
   prune 的同类处理。manifest 仍以 marker 作为唯一所有权信号，避免把预先存在的
   用户文件误认为 Trellis 文件。

## 不采用的方案

- 不建立“任意宿主入口文件”注册表：当前只有两个已确认的入口，增加注册、策略
  类型和扩展点没有调用方。
- 不复制两份完整 Markdown 正文，也不在运行时读开发机绝对路径。
- 不为 Claude 新增一套冲突、备份或 hash 算法；全部复用已验证的 managed-block
  机制。

## 验收映射

- Claude-only、Codex-only、Claude+Codex init 分别验证入口文件存在性，双端时
  验证两份内容一致。
- 增量 `init --claude` 验证既有 Codex 项目能补齐 `CLAUDE.md`。
- update 验证 Claude 入口的 pristine hash、marker 内用户修改、无 marker 用户
  内容三条路径；manifest prune 验证不删除用户自有 `CLAUDE.md` 的 hash 记录。
- 架构审查检查实现只新增一份共享正文、一个必要的私有复用函数，以及现有生命周期
  的接线；任何额外的配置、回退或抽象均应删除。
