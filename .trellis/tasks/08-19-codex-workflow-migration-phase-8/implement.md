# 阶段 8 实施记录

## 实施顺序

1. 阅读 release-preflight、pnpm pack、verify-packed-cli 和既有发布测试，确认复用边界。
2. 先运行现有 tarball/clean-install 测试，定位 tar 条目换行解析缺陷和清单断言不足。
3. 修正 verify-tarball-manifest 的换行解析、Windows 开发机路径转义，补齐 templates/skills/agents/hooks/workflow/migration 前缀。
4. 扩展 clean-install consumer：三种 init、双向增量启用、update --migrate；将 tgz 复制到 consumer artifacts 后以相对路径安装；真实调用 task create/add-context/current/finish/start/validate/archive 和 workflow phase context，逐门写入 review PASS 后 validate，检查路径与换行。
5. 运行定向测试、preflight、全量 build/test/typecheck/lint、Python compile、task validate 和 diff-check。
6. 依次执行 spec-review、code-review、code-architecture-review、merge-review；通过后创建阶段 8唯一提交并停止。

## 当前验证快照

- release-preflight clean-install 定向：1 file、10 passed，testTimeout=240000。
- verify-tarball-manifest：通过，版本 0.6.0-beta.31。
- CLI tarball：trellis-hgl-0.6.0-beta.31.tgz，670 entries，688975 bytes。
- Core tarball：trellis-hgl-core-0.6.0-beta.31.tgz，202 entries，122883 bytes。
- workspace 全量：Core 16 files / 272 passed；CLI 45 passed files、1 skipped file，1300 passed、3 skipped。
- pnpm typecheck、pnpm build、pnpm lint：通过。
- Python compile、task.py validate、git diff --check：阶段 8提交前已复核通过。
- clean-install runtime artifacts：已从 consumer 自有 artifacts 相对路径安装，运行时不依赖源码 checkout 或 matt-skills-main。

## 失败恢复证据

- clean-install 测试使用系统临时目录 trellis-tarball-pack-* 与 trellis-clean-consumer-*，finally 删除两者。
- 本次第一次 preflight 暴露字面量换行 regex，修复后重新运行通过；未修改源码外部路径。