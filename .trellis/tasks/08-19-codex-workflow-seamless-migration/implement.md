# Codex 工作流无缝迁移执行计划

## 执行顺序

1. 完成阶段 0 的现状审计、基线命令和迁移契约提交。
2. 每次只启动一个有明确依赖的阶段；开始前复核上一阶段提交、交接记录和声明的测试结果。
3. 由执行 agent 实施本阶段范围内的改动和附近测试；协调会话负责验证任务边界、派发独立 review、收敛失败并安排重跑。
4. 已启用 review gate 失败时，回到本阶段实现，重跑当前 gate；连续失败三次时停止并向用户升级风险。
5. 阶段通过后，更新中文交接记录，提交该阶段全部任务与产品变更，再推进下一阶段。
6. 阶段 9 在所有阶段提交之上完成独立合并后 review 和全量发布验收。

## 基线与最终验证

```bash
pnpm build
pnpm test
pnpm typecheck
pnpm lint
pnpm pack
```

阶段 0 仅记录前四项基线。阶段 8 与阶段 9 额外执行 tarball 清单、clean-install consumer E2E 及无绝对路径检查。

## 提交与回滚

- 迁移分支：`task/codex-workflow-seamless-migration`；目标分支：`main`。
- 每个阶段通过后使用一条单独提交，提交消息采用 `feat(trellis): complete codex workflow migration phase N`；阶段 0 使用 `chore(trellis): establish codex workflow migration baseline`。
- 发现跨阶段回归时，以阶段提交为回滚边界，先停止后续阶段，再新建修复提交；不重写已有提交或覆盖用户未关联的改动。
