# 阶段 8 Spec Review

结论：PASS

## 范围核对

- release-preflight.test.ts 实际调用 verify-tarball-manifest，并验证 templates、skills、agents、hooks、workflow、migration manifests。
- CLI/core tgz 在 consumer 自有 artifacts/ 目录中以相对路径安装；清除 NODE_PATH / NODE_OPTIONS，安装 realpath 位于 consumer 且不指向源码 checkout。
- 覆盖 Claude-only、Codex-only、Claude + Codex init，双向增量启用与 update --migrate。
- 通过已安装包内 task.py、get_context.py 执行 create、planning/context、strategy artifacts、start/finish/current、逐门 review validate、phase 3.1/3.5 与 archive。
- 扫描安装包文本和生成入口文件，拒绝 matt-skills-main、canonical 开发机路径及孤立 CR；发布 workflow 已接入 tarball preflight。

## 验证

- pnpm exec vitest run test/commands/release-preflight.test.ts --pool=forks --maxWorkers=1 --testTimeout=240000：1 file，10 passed。
- node packages/cli/scripts/release-preflight.js verify-tarball-manifest：通过。
- 无阶段 9内容混入。

残余风险：当前验证主机为 Windows，未运行 Linux 矩阵；现有 task.py 没有独立 review CLI，因此 review 状态由测试写入后再由真实 validate 校验。