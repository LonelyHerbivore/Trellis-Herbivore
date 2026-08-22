# 阶段 8 技术设计：npm tarball 与干净环境 E2E

## 边界

只验证发布包，不从源码目录直接执行 consumer 工作流。阶段 7 的 update/migration 代码已在 c47fdb3 提交；本阶段只维护 release-preflight 的 tarball 断言和真实 consumer fixture。

## 设计决策

1. 复用 release-preflight 已有的 withSyncedPackageDocs、packWorkspacePackage、verify-packed-cli 和版本检查；新增 verify-tarball-manifest 只负责列出 tar 条目、检查必需前缀和开发机路径 token。
2. CLI tarball 的必需资产按 PRD 明确分组检查：Claude/Codex agents、Codex hooks、common skills、bundled skills、shared hooks、Trellis workflow 和 migration manifests；core tarball 至少包含 dist。
3. clean-install 测试在系统临时目录创建 packDir 与 consumerRoot，先将两个 tgz 复制到 consumer 自有 artifacts 目录，再以相对路径安装；consumer 运行时清除 NODE_PATH/NODE_OPTIONS，测试结束删除临时目录，不污染仓库。
4. consumer 通过真实 trellis init/update 和内置 task.py 命令写入 explicit-selection-v1 workflow，依次执行 validate、start、四个 PASS review 报告、再次 validate 和 archive。
5. Windows 路径使用 path.join 和平台感知的 npm/py 命令；生成文件检查 CRLF/LF 均可读，并拒绝 D:\Trellis、C:\Users\asus、matt-skills-main token。
6. 发现 tar 条目换行解析使用了字面量反斜杠的问题后，改为标准 /\r?\n/ 分割；开发机路径检测使用 JS 正确转义。

## 失败恢复

- pack/安装/命令任一步失败，测试 finally 删除 packDir 与 consumerRoot；不会触碰当前 checkout 的源码或环境改动。
- preflight 发现缺失资产、路径泄漏或版本不一致时立即 fail，不回退到源码目录或网络包。