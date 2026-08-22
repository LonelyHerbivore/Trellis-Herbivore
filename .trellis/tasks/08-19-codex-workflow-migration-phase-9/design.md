# 阶段 9 设计：最终集成与发布就绪验收

## 范围

阶段 9 只收敛阶段 0 至阶段 8 的交接证据、发布阻塞问题和最终验收文档，不新增双端产品能力，不启动阶段 10。

## 集成决策

1. 阶段 0 的产品基线提交已存在，但任务元数据仍为 planning；阶段 9 补齐状态、完成时间和提交关联，保留原始基线内容。
2. 阶段 1 至阶段 8 的历史 task metadata 统一补充 canonical `workflow.review_gates` 记录；原有 `meta.review_gate_status` 仅作为兼容性历史字段保留，不再作为运行时事实来源。
3. `pack-publish-artifacts` 的 tarball 输出放在系统临时目录，避免污染 checkout 或被 release 脚本的宽泛暂存范围带入提交。
4. 当前版本仍为 `0.6.0-beta.31`，该版本已存在于 npm 且旧 tag 指向旧提交；本阶段只生成 beta.32 发布计划和命令草稿，不执行版本 bump、tag、push、GitHub Release 或 npm publish。
5. 当前工作区中的 `.gitignore`、`%SystemDrive%/` 和 `packages/cli/%SystemDrive%/` 属于用户/环境改动，阶段 9 不修改、不暂存、不还原、不删除。

## 验收顺序

先运行质量门禁与发布预检，再依次执行 spec-review、code-review、code-architecture-review、merge-review；全部通过后写入中文交接、发布草稿和最终提交。

## 已知限制

- 当前验证主机为 Windows，未运行 Linux CI 矩阵。
- clean-install 已验证本地 tarball consumer 安装和双端流程；另以隔离 prefix 执行 `npm install -g` 语义的全局安装 E2E，验证安装后的 CLI 可完成 Claude init、Codex init 和 update/migration。
- historical review 产物的独立 agent 供给不一致；阶段 9已补录阶段 1 至 3 的当前独立回溯报告，所有报告必须区分当时协调会话复核与本次独立集成审查。
