# Codex 工作流无缝迁移 - 阶段 0：基线与迁移契约

## 目标

建立可重复核验的迁移基线、父子任务树和阶段契约，为后续九个实施阶段提供唯一事实来源。

## 需求

- 记录当前 Git 分支、工作目录、工作树状态与 npm 发布版本。
- 建立一个父任务和阶段 0 到阶段 9 的子任务，并把阶段依赖、提交策略和交接要求写入父任务。
- 绘制 init、update、workflow、templates、migrations、packaging、task schema 和 Codex adapter 的当前入口地图。
- 复核 Claude-only 与 Codex-only 的初始化产物清单、Codex-specific skill 资源路径、legacy Codex marker 与 npm pack 入口。
- 运行 build、test、typecheck、lint，记录成功、失败或环境阻塞，后续阶段不得将已记录的基线问题误判为回归。
- 不修改产品运行时行为、模板或发布产物；本阶段仅允许任务与规划文档变更。

## 验收标准

- [x] 父任务包含 10 个按阶段排序的子任务，所有任务均指向迁移分支和 `main` 集成目标。
- [x] 父任务和阶段 0 记录实际工作目录、协调模式、开发流程与 review 选择。
- [x] `design.md` 明确迁移不变量、兼容边界和阶段依赖。
- [x] `implement.md` 明确基线命令、证据位置、阶段完成提交格式和回滚点。
- [x] build、test、typecheck、lint 的实际结果已写入阶段交接记录。
- [x] 阶段 0 产物通过范围核查，并准备形成独立 Git 提交。
