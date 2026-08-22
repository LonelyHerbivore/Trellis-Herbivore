# 阶段 8 交接

## 状态

阶段 8实现、四道 review gate、主要验证和唯一提交均已完成；阶段 9负责最终集成与发布就绪验收。

## 已完成

- release-preflight 新增 verify-tarball-manifest，复用现有 packWorkspacePackage 和版本检查。
- CLI tarball 清单覆盖 templates、common skills、bundled skills、Claude/Codex agents、Codex hooks、shared hooks、workflow、migration manifests；core tarball dist 存在性也受检。
- 开发机路径 token 检查覆盖 matt-skills-main、D:\Trellis、C:\Users\asus。
- clean-install consumer 将 CLI/core tgz 复制到自身 artifacts 目录后以相对路径安装，验证 Claude-only、Codex-only、mixed init，Claude -> Codex、Codex -> Claude 增量启用和 mixed update --migrate；运行时清除 NODE_PATH/NODE_OPTIONS，不依赖源码 checkout。
- 最小 task 流程真实执行 create、explicit-selection-v1 planning/strategy/implement artifact、validate、start、四个 PASS review、再次 validate、archive/final validation。
- Windows/Linux npm/py/path.join 和 LF/CRLF 可读性检查。

## 验证

- 定向 release-preflight：1 file / 10 passed（含独立 runtime artifacts clean-install）。
- verify-tarball-manifest：通过。
- Core 全量：16 files / 272 passed。
- CLI 全量：45 files passed、1 skipped file，1300 passed、3 skipped。
- typecheck、build、lint：通过；Python compile、task validate、diff-check 在提交前复核。

## 阶段 9前置条件

阶段 9只有在阶段 8唯一提交成功后才允许启动；本阶段不执行最终集成、发布 push 或额外平台扩展。阶段 8提交后立即停止。