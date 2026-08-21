# 阶段 5 设计：review agents 与共享合同

## 已确认的决策

- 当前任务继续在 `D:\Trellis\Trellis-0.6.0-beta.17` 当前 checkout 中执行；宿主为 Codex，采用 subagent 编排、默认开发流程，四个 review gate 都启用。
- 复用阶段 1 已落盘的 `task.json.workflow.review_gates` 合同：gate key 固定为 `spec-review`、`code-review`、`code-architecture-review`、`merge-review`；`task.worktree_path` 是唯一实际工作目录；不新建第二套 review 状态、JSONL、注册表或 schema 字段。
- 任何选择或消费 subagent + worktree 目录的生成 prompt 都必须以 `task.worktree_path` 为准：planning/start 将用户选定的实际目录写入该字段，implement/check/review 读取该字段，不得从 task 目录名推导或用静态默认路径覆盖。该调整只消除提示词冲突，不增加 worktree 创建、切换、嵌套、同步或复用运行时。
- 新增四个 Codex TOML agent，均为 `sandbox_mode = "read-only"`，同时以 `[features] multi_agent = false` 和 `[features.multi_agent_v2] enabled = false` 结构性禁止递归派生。`trellis-check` 保持既有 workspace-write/self-fix 职责，不替代任何 review gate。
- 为实现跨宿主共享合同，既有四个 Claude review 模板也读取同一 `task.json`，采用相同的 gate 选择、legacy/invalid 边界和报告字段；只调整 prompt 合同，不改 Claude hook、dispatch 或工作树行为。
- Codex review agents 复用 `check.jsonl` 和现有 pull-based `check` prelude；只扩展既有名称识别，并在同一 prelude 中为 review 名称加入条件式 task-record-first 步骤。`trellis-implement` 与 `trellis-check` 明确跳过该步骤、继续原有 Step 2，不增加 review 专属 prelude 类型或平行 context bucket。
- 所有 review agent 的 dispatch prompt 第一行必须是 `Active task: <task path>`。agent 先读取 `<task-path>/task.json`，据此确认 `worktree_path`、gate 是否 enabled、legacy/非法合同，再读取 check context 与任务文档。
- “只读 review agent”与“报告落盘”由职责分离解决：review agent 只读并返回统一 Markdown 报告；主会话在收到报告后将其写入 `<task-path>/reports/<gate>.md`，并更新既有 `workflow.review_gates.runs[gate]` 的 `status`、`attempts`、`report_path`。不新增未被运行时调用的 `task.py` report 命令或写入 abstraction。
- shared workflow 模板是 review dispatch 的唯一生产合同；因为实际分派由宿主主会话按生成的 workflow 执行，而不是 CLI 运行时执行，所以不新增仅供测试调用的 dispatch-plan 工具函数。模板测试同时检查 Claude/Codex 的 agent 合同、legacy/invalid 边界、disabled 行为和固定 spec -> code -> architecture -> merge 顺序。
- `attempts` 表示当前 gate 的连续审查次数：主会话在同一 gate FAIL 后修复并重跑，达到 3 次连续 FAIL 时向用户升级并请求是否标记该 gate 为 `skipped`；PASS 后才允许进入下一 gate。该语义使用已有字段，不引入推测性的 `consecutive_failures`。
- shared workflow 对 Claude、Codex sub-agent 与 Codex inline 使用同一 gate 选择、顺序、报告和重跑合同。inline 只是不委派 implementation；已启用 review gate 仍须独立执行，不能静默退化为 `trellis-check` 自修复。
- merge-review 只在合并后、最终 build/test 前运行；本阶段不实现合并编排、worktree 创建、路径复用或 snapshot sync，这些属于阶段 6。

## 数据流

```text
主会话读取 task.json.workflow
  ├─ legacy：保持既有 trellis-check 兼容路径
  ├─ explicit + enabled gate
  │    ├─ dispatch prompt: Active task: <task path>
  │    ├─ Codex / Claude review agent（只读）
  │    └─ PASS / FAIL + file:line 证据 + blocking + next actions
  │              ↓
  │       主会话写 reports/<gate>.md
  │       主会话更新 runs[gate]
  │              ↓
  │       PASS → 下一 gate；FAIL → 修复后重跑当前 gate
  └─ invalid：停止并修复 task workflow 合同
```

## 修改边界

- 新增：`packages/cli/src/templates/codex/agents/trellis-{spec-review,code-review,code-architecture-review,merge-review}.toml`。
- 修改：Codex pull-based prelude 名称识别和 review-only task-record-first 顺序、shared workflow 与 native 镜像文案、common planning/start/before-dev prompt、既有 Claude implement/check 与四个 Claude review 模板的 task-record/worktree/报告合同，以及贴近这些行为的 template/configurator/init/更新回归测试。
- 不修改：Core task schema、生成 Python task validator、Claude hook/dispatch/worktree 行为、worktree sync/create/reuse、平台 agent 注册表。Codex agent 目录扫描、init 写入和 update/hash 收集已经自动覆盖新增 TOML。

## 验证矩阵

- Codex inventory 与 init/update 生成物包含原有 3 个 agent 和新增 4 个 review agent。
- 四个 review TOML 都为只读、包含 pull prelude、first-line active-task 合同、在 check context 前的 task-record 校验、递归防护与统一报告格式。
- 共享 workflow 与 Claude/Codex review agent 模板共同声明相同的 spec-review -> code-review -> code-architecture-review 顺序、disabled 不 dispatch、legacy 走 trellis-check 兼容路径，以及 unselected/非法合同停止 review loop；模板测试覆盖这些跨宿主合同。
- structured task fixture 仅在 host 字段不同的 Claude/Codex 变体上得到相同的保序 gate 列表；shared workflow、common prompt 和 Claude implement/check 均断言 `task.worktree_path` 是唯一实际目录且不保留静态默认路径。
- 共享 workflow 明确由主会话写报告和更新 run；连续 3 次 FAIL 升级；merge-review 位于合并后、最终 build/test 前。
- 架构审查专门检查没有新增 report CLI、review state registry、第二套 context bucket、无调用方 abstraction 或阶段 6 worktree 逻辑。
