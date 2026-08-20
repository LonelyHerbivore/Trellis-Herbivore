# 阶段 4 设计：skills、hooks 与启动可靠性

## 已确认的决策

- 当前任务在 `D:\Trellis\Trellis-0.6.0-beta.17` 当前 checkout 中执行；宿主为 Codex，采用 subagent 编排、默认开发流程，四个 review gate 均启用。
- Codex 的可发现 skill 统一安装到 `.agents/skills/`。`.codex/` 只承载 Codex agents、hooks、`hooks.json` 和项目级 `config.toml`，不再维持第二个 `.codex/skills/` 安装层。
- 现有 `templates/codex/skills/` 是未接入且大多已退休或与 common 重复的旧资源，不能仅把读取路径从 `codex-skills/` 改成 `skills/` 后重新发布。删除这条死路径；仍被工作流引用的 `break-loop` 迁入 common 单一来源并通过 `.agents/skills/trellis-break-loop/` 安装。
- hooks 不能由项目配置替用户开启或批准。共享入口模板只增加一句 Codex 条件式提示：自动注入不可用时先调用 `$trellis-start`；详细恢复步骤继续只在由 `common/commands/start.md` 生成的 `trellis-start` 中维护。
- 每次 Codex `init` / `update` 都检查用户级 `default_mode_request_user_input`。只在明确展示目标、拟写入键和值、备份位置后得到一次独立确认时才写；`--yes`、`--force` 和项目模板的确认不等同于这项用户级授权。失败、拒绝、dry-run、格式冲突或无法备份时不阻塞项目 assets，返回可执行手工指引。
- `.codex/` 也是 Codex 自身的运行时目录，不能以目录存在作为 Trellis 已启用的依据。仅项目 `config.toml` 中的 Trellis 签名或 `.codex/agents/trellis-*.toml` 作为识别标记；`sessions/` 等用户运行时数据不会触发 update 或用户级配置写入。
- Claude→Codex 增量初始化只替换已有 `AGENTS.md` 的 `<!-- TRELLIS:START -->…<!-- TRELLIS:END -->` 托管块，保留块外内容；无标记的用户文件不覆盖，明确提示在 hooks 不可用时手动调用 `$trellis-start`。
- 纯文本 TOML 补丁不会合并顶层 `features = { ... }` inline table；TOML 与 cc-switch 都会在确认窗口结束后重新读取当前内容，内容改变或无法重新读取即取消自动写入，避免用过期计划覆盖用户修改。

## 变更边界与数据流

```text
common skill source
  ├─ common/skills/break-loop.md
  └─ common commands/start.md
          │ build / npm pack
          ▼
dist/templates/common/...
          │ trellis init / update
          ▼
.agents/skills/trellis-break-loop/ + .agents/skills/trellis-start/
          │
          └─ AGENTS.md 的简短 fallback 指向 trellis-start

Codex init/update
  └─ 读取 cc-switch.db.settings.common_config_codex（优先）
       或 ~/.codex/config.toml（fallback）
      → 展示目标、键值、备份方式 → 明确确认 → 最小补丁写入
```

## 用户级配置写入契约

1. 优先检测 `$HOME/.cc-switch/cc-switch.db`，且只操作 `settings` 表中的 `common_config_codex`；读取、写入和数据库备份经 Python 标准库 `sqlite3` 完成。TOML 语法验证使用打包的 `@iarna/toml`，因此不依赖 Python 3.11+ 的 `tomllib`，也不新增原生 Node 依赖。
2. cc-switch 不存在或无法作为可写目标使用时，改用 `$HOME/.codex/config.toml`。文本补丁只处理精确的 `[features]` section 和 `default_mode_request_user_input = true`，保留未知行、注释和既有换行符。
3. 已为 `true` 时不写、没有备份；不存在或可安全补齐时先建立同目录恢复备份；已有 `false` 或非布尔值时视为冲突，不静默覆盖。确认后在真实写入前会重新读取 cc-switch 或 TOML；内容发生变化或读取失败时取消，不使用过期计划写入。
4. 工具函数只返回明确状态与人工指引；cc-switch 的手工指引明确指向 `settings.common_config_codex`，TOML 路径则指向对应文件的 `[features]`。`init.ts` / `update.ts` 是唯一调用方。不会增加无调用方配置层、全局状态或推测性兼容分支。

## 兼容与回滚

- 不覆盖项目的 `AGENTS.md` managed block 外内容，也不尝试在项目 `.codex/config.toml` 写用户级 feature。
- 不触碰用户已有 `.gitignore` 改动。
- 用户级写入前的数据库或 TOML 备份是恢复点；项目代码改动由本阶段 `.codex-backups` 批次的 `.bak` / `.patch` 恢复。
- 历史项目中可能残留的 `.codex/skills` 清理/迁移不在本阶段提前实施，留给阶段 7 的 migration 验收。

## 验证矩阵

- source / build dist / npm tarball / 临时 Codex 项目均存在 `trellis-start` 和 `trellis-break-loop` 的唯一可发现来源。
- Codex-only init、Codex update、Claude-only init 与 Claude-only update 的用户级配置调用边界正确。
- cc-switch 优先、fallback TOML、缺失、已正确、其他 feature、冲突格式、内联 table、拒绝、备份失败、写入失败、确认期间并发变更、dry-run 和 no-op update 均有自动化覆盖。
- hooks 未启用或未批准时，生成的 `AGENTS.md` 仍给出 `$trellis-start` 的明确入口。
