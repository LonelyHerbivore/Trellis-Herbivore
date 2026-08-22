# Tarball Manifest Evidence

执行日期：2026-08-22

## Preflight 命令

node packages/cli/scripts/release-preflight.js verify-tarball-manifest

输出：ok tarballs contain runtime assets for 0.6.0-beta.31.

## 本地 pack 结果

- CLI：trellis-hgl-0.6.0-beta.31.tgz，670 entries，688975 bytes。
- Core：trellis-hgl-core-0.6.0-beta.31.tgz，202 entries，122883 bytes。
- 清单检查使用 tar -tzf；CLI 必需前缀包括：
  - package/bin/trellis.js
  - package/dist/templates/claude/agents/
  - package/dist/templates/codex/agents/
  - package/dist/templates/codex/hooks/
  - package/dist/templates/common/skills/
  - package/dist/templates/common/bundled-skills/
  - package/dist/templates/shared-hooks/
  - package/dist/templates/trellis/workflow.md
  - package/dist/migrations/manifests/
- Core 必须包含 package/dist/。

## 隔离与恢复

- tarball 解压检查拒绝 matt-skills-main、D:\Trellis、C:\Users\asus token。
- clean-install 使用 trellis-tarball-pack-* 与 trellis-clean-consumer-* 临时目录；测试 finally 删除目录。
- consumer 只安装本地 CLI/core tgz，不读取当前源码目录或 matt-skills-main。