# 阶段 8 Code Review

结论：PASS

## 关键检查

- release-preflight.js:348-364 使用 execFileSync、path.basename 和 cwd=path.dirname(...)，避免 Windows D: 被 GNU tar 解析为远程主机。
- release-preflight.test.ts:462-472 按 package.json 包名精确选择 CLI/core tgz，并排除 core 前缀交叉匹配。
- release-preflight.test.ts:478-527 复制 tgz 到 consumer artifacts，以相对路径安装，验证安装路径/内容隔离和路径换行卫生。
- release-preflight.test.ts:529-736 覆盖 init/update、task/context/phase、review validate、archive。
- .github/workflows/publish.yml:75-76 在发布前执行 verify-tarball-manifest。

## 验证

- release-preflight 测试 10/10 passed。
- core 272 passed；CLI 1300 passed、3 skipped。
- typecheck、build、lint、Python compile、task validate、diff-check 通过。

非阻断观察：manifest 命令会重新 pack 一组 tarball，而不是接收 pack-publish-artifacts 输出的同一组文件；当前源码/版本一致，未形成阶段阻断。