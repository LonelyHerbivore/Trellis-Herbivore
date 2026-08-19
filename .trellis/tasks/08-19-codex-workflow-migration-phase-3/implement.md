# 阶段 3 实施清单：init/update 平台组合

## 执行步骤

1. 在现有 init 集成测试中覆盖 Claude -> Codex 的增量添加、重复 init、
   `--skip-existing` partial recovery 与 `--force` 的 hash 保留行为。
2. 在 update 集成测试中覆盖 Claude + Codex 模板的同次收集，以及共享
   `.agents/skills/` 的 Gemini 项目不会被识别为 Codex legacy install。
3. 只在非首次完整 init 时合并原 hash manifest；不改变 fresh init 和平台识别算法。
4. 运行定向测试和 workspace 全量质量门禁，进行 spec/code/architecture review。

## 验证顺序

```bash
pnpm --filter trellis-hgl test -- test/commands/init.integration.test.ts
pnpm --filter trellis-hgl test -- test/commands/update.integration.test.ts
pnpm typecheck
pnpm build
pnpm test -- --reporter=dot
pnpm lint
git diff --check
```

## Review 闸门

- spec-review：逐项检查五种平台组合、重复 init、force/skip、partial recovery、hash
  合并与 update 收集。
- code-review：检查 init 分支是否只在已有项目合并 hash，以及用户文件/运行数据没有
  被纳入 ownership。
- code-architecture-review：拒绝平台组合注册表、重复检测、额外配置或无调用方的恢复
  抽象；优先复用既有 registry、写入记录和 hash merge。
- merge-review：留给阶段 9 最终集成。
