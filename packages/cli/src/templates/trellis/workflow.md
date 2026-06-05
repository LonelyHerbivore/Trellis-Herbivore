# 开发工作流

---

## 核心原则

1. **先规划，再编码** —— 动手前先想清楚要做什么
2. **规范靠注入，不靠记忆** —— 指南通过 hook / skill 注入，而不是靠记住
3. **所有信息都要落盘** —— 调研、决策、经验都写进文件；对话会被压缩，文件不会
4. **增量式开发** —— 一次只处理一个任务
5. **沉淀经验** —— 每个任务结束后回顾，并把新知识写回 spec

---

## Trellis 系统

### 开发者身份

首次使用时，先初始化你的身份：

```bash
python3 ./.trellis/scripts/init_developer.py <你的名字>
```

这会创建 `.trellis/.developer`（已 gitignore）以及 `.trellis/workspace/<你的名字>/`。

### Spec 系统

`.trellis/spec/` 用来存放按 package 和 layer 组织的编码规范。

- `.trellis/spec/<package>/<layer>/index.md` —— 入口文件，包含**开发前检查清单**与**质量检查**。具体规范写在它引用的 `.md` 文件中。
- `.trellis/spec/guides/index.md` —— 跨 package 的通用思考指南。

```bash
python3 ./.trellis/scripts/get_context.py --mode packages   # 列出可用 package / layer
```

**什么时候更新 spec**：发现新模式 / 新约定 · 需要把 bug 修复经验沉淀成预防规则 · 形成新的技术决策。

### 任务系统

每个任务在 `.trellis/tasks/{MM-DD-name}/` 下都有自己的目录，里面包含 `task.json`、`prd.md`、可选的 `design.md`、可选的 `implement.md`、可选的 `research/`，以及供支持子代理的平台使用的上下文清单（`implement.jsonl`、`check.jsonl`）。

```bash
# 任务生命周期
python3 ./.trellis/scripts/task.py create "<标题>" [--slug <name>] [--parent <dir>]
python3 ./.trellis/scripts/task.py start <name>          # 设置当前活动任务（有会话身份时为会话级）
python3 ./.trellis/scripts/task.py current --source      # 显示当前任务及其来源
python3 ./.trellis/scripts/task.py finish                # 清除当前活动任务（触发 after_finish hooks）
python3 ./.trellis/scripts/task.py archive <name>        # 移动到 archive/{year-month}/
python3 ./.trellis/scripts/task.py list [--mine] [--status <s>]
python3 ./.trellis/scripts/task.py list-archive

# 代码规范上下文（通过 JSONL 注入 implement/check 子代理）。
# `implement.jsonl` / `check.jsonl` 会在 `task create` 时为支持子代理的平台预置种子行；
# 之后由 AI 在规划阶段补成真实 spec / research 条目。
python3 ./.trellis/scripts/task.py add-context <name> <action> <file> <reason>
python3 ./.trellis/scripts/task.py list-context <name> [action]
python3 ./.trellis/scripts/task.py validate <name>

# 任务元数据
python3 ./.trellis/scripts/task.py set-branch <name> <branch>
python3 ./.trellis/scripts/task.py set-base-branch <name> <branch>    # PR 目标分支
python3 ./.trellis/scripts/task.py set-scope <name> <scope>

# 层级关系（父 / 子任务）
python3 ./.trellis/scripts/task.py add-subtask <parent> <child>
python3 ./.trellis/scripts/task.py remove-subtask <parent> <child>

# 创建 PR
python3 ./.trellis/scripts/task.py create-pr [name] [--dry-run]
```

> 可运行 `python3 ./.trellis/scripts/task.py --help` 查看权威且最新的命令列表。

**当前任务机制**：`task.py create` 会创建任务目录，并在存在会话身份时自动设置当前会话的活动任务指针，这样 planning breadcrumb 会立即生效。`task.py start` 会写入同一个指针（如果已存在则幂等），并把 `task.json.status` 从 `planning` 切换为 `in_progress`。状态文件保存在 `.trellis/.runtime/sessions/` 下。如果 hook 输入、`TRELLIS_CONTEXT_ID` 或平台原生会话环境变量里都没有上下文 key，则不会有活动任务，`task.py start` 会提示缺少会话身份。`task.py finish` 只删除当前会话文件（不改任务状态）。`task.py archive <task>` 会写入 `status=completed`、移动目录到 `archive/`，并删除仍指向该任务的运行时会话文件。

### Workspace 系统

它会在 `.trellis/workspace/<developer>/` 下记录每次 AI 会话，便于跨会话追踪。

- `journal-N.md` —— 会话日志。**每个文件最多 2000 行**；超出后会自动创建新的 `journal-(N+1).md`
- `index.md` —— 个人索引（总会话数、最近活跃时间）

```bash
python3 ./.trellis/scripts/add_session.py --title "标题" --commit "hash" --summary "摘要"
```

### 上下文脚本

```bash
python3 ./.trellis/scripts/get_context.py                            # 完整会话运行时上下文
python3 ./.trellis/scripts/get_context.py --mode packages            # 可用 package + spec layer
python3 ./.trellis/scripts/get_context.py --mode phase --step <X.Y>  # 读取某个工作流步骤的详细说明
```

---

<!--
  WORKFLOW-STATE BREADCRUMB CONTRACT（修改下面标签块前先读）

  `## Phase Index` 下面嵌入的 [workflow-state:STATUS] 块，是每个支持平台的
  UserPromptSubmit hook 读取的每回合 `<workflow-state>` breadcrumb 的**唯一事实来源**。
  inject-workflow-state.py（Python 平台）和 inject-workflow-state.js（OpenCode 插件）
  只负责解析这里，不再保留 v0.5.0-rc.0 之前的后备字典。

  STATUS 允许字符集：[A-Za-z0-9_-]。如果 hook 找不到标签，就会退化成一条通用提示：
  "Refer to workflow.md for current step." —— 这是故意保留的可见退化，方便用户发现并修复损坏的 workflow.md。

  不变量（test/regression.test.ts）：
    每个被标记为 `[required · once]` 的 workflow-walkthrough 步骤，必须在对应 phase 的
    [workflow-state:*] 块里有匹配的 enforcement 文案。breadcrumb 是唯一的逐回合信道；
    如果某个必经步骤没有写进这里，AI 就会静默跳过（Phase 1 的规划门禁跳过、Phase 3.4 的 commit 跳过都曾因此出现）。

  TAG ↔ PHASE 作用域：
    [workflow-state:no_task]      → 没有活动任务；Phase 1 之前
    [workflow-state:planning]     → Phase 1 全阶段（status='planning'）
    [workflow-state:planning-inline] → Codex 的 Phase 1 内联变体
    [workflow-state:in_progress]  → Phase 2 + Phase 3.1-3.5
                                    （从 task.py start 到 task.py archive 期间状态都保持 'in_progress'）
    [workflow-state:in_progress-inline] → Codex 的 Phase 2/3 内联变体
    [workflow-state:completed]    → 当前为 DEAD：cmd_archive 会在同一次调用里改状态并移动目录，
                                    导致 resolver 丢失指针（这个块保留给未来显式的 in_progress→completed 转换）

  编辑检查清单：
    - 你修改某个 [workflow-state:STATUS] 块时，也要同步检查该 phase 下所有 `[required · once]` 步骤是否一致
    - 修改后运行 `trellis update`，把新的 block 内容推送到下游用户项目（按块托管替换）
    - 完整运行时约定见：
      .trellis/spec/cli/backend/workflow-state-contract.md
-->

## Phase Index

```
Phase 1: Plan    → 分类请求、取得创建任务的同意、然后写规划产物
Phase 2: Execute → 只有任务状态进入 in_progress 后才开始实现
Phase 3: Finish  → 验证、更新 spec、提交代码、最后收尾
```

### Request Triage

- 简单对话或小任务：只问这次是否需要创建 Trellis 任务；如果用户说不需要，本次会话就跳过 Trellis。
- 复杂任务：先问用户是否允许创建 Trellis 任务并进入 planning。如果用户不同意，就不要做大范围内联实现，只做说明、澄清范围，或建议拆成更小的问题。
- 用户同意创建任务，不等于同意直接开始实现；实现前仍然需要先完成 planning。

### Planning Artifacts

- `prd.md` —— 需求、约束与验收标准。不要把技术设计或执行清单写进这里。
- `design.md` —— 复杂任务的技术设计：边界、契约、数据流、权衡、兼容性、上线 / 回滚形态。
- `implement.md` —— 复杂任务的执行计划：开发策略决策、有序清单、review 闸门、验证命令、回滚点。
- `implement.jsonl` / `check.jsonl` —— 提供给子代理的 spec / research 清单。它们不能替代 `implement.md`。
- 轻量任务可以只保留 PRD；复杂任务在 `task.py start` 前必须补齐 `prd.md`、`design.md` 与 `implement.md`。

### Parent / Child Task Trees

当一个用户请求包含多个可独立验证的交付物时，使用父任务。父任务负责源需求集合、任务地图、跨子任务验收标准以及最终集成评审；除非它本身也有直接工作，否则通常不应作为实现目标。This means one request can cover several independently verifiable deliverables.

对子任务，应保证它们都可以独立地完成 planning、implement、check 与 archive。父子结构不是依赖系统：如果某个子任务必须等待另一个子任务，应该把这个顺序写在子任务自己的 `prd.md` / `implement.md` 里，并保持各子任务的验收标准可独立验证。Parent/child structure is not a dependency system: if one child must wait for another, write that ordering in the child artifacts instead.

用 `task.py create "<标题>" --slug <name> --parent <parent-dir>` 创建新的子任务。用 `task.py add-subtask <parent> <child>` 关联已有任务；如果连错了，用 `task.py remove-subtask <parent> <child>` 解除。创建完后，start the child that owns the next independently verifiable deliverable。

<!-- Per-turn breadcrumb: shown when there is no active task (before Phase 1) -->

[workflow-state:no_task]
No active task. First classify the current turn and ask for task-creation consent before creating any Trellis task.
Simple conversation / small task: ask only whether this turn should create a Trellis task. If the user says no, skip Trellis for this session.
Complex task: ask the user if you can create a Trellis task and enter the planning phase. If the user says no, explain, clarify scope, or suggest a smaller split.

当用户用自然语言提出 Claude Code 工作流改动时，先引导他们进入 `task.py create`；不要要求固定命令短语。
[/workflow-state:no_task]

### Phase 1: Plan
- 1.0 Create task `[required · once]`（只有获得 task-creation consent 后才能执行）
- 1.1 Requirement exploration `[required · repeatable]`（`prd.md`；复杂任务还需要 `design.md` + `implement.md`）
- 1.2 Research `[optional · repeatable]`
- 1.3 Configure context `[required · once]` —— Claude Code、Cursor、OpenCode、Codex、Kiro、Gemini、Qoder、CodeBuddy、Copilot、Droid、Pi
- 1.4 Activate task `[required · once]`（review gate 通过后执行 `task.py start`；状态切到 in_progress）
- 1.5 Completion criteria

<!-- Per-turn breadcrumb: shown throughout Phase 1 (status='planning') -->

[workflow-state:planning]
Load `trellis-brainstorm`; stay in planning.
Lightweight: `prd.md` can be enough. Complex: finish `prd.md`, `design.md`, and `implement.md`; ask for review before `task.py start`.
Multi-deliverable scope: consider a parent task plus independently verifiable child tasks; dependencies must be written in child artifacts, not implied by tree position.
Sub-agent mode: curate `implement.jsonl` and `check.jsonl` as spec/research manifests before start.

Planning order for this Claude Code path: `task.py create` → `trellis-brainstorm` → `trellis-grill-me` → development strategy decision.
`trellis-grill-me` is a required planning gate on this Claude Code path, not an optional suggestion.
Before `trellis-grill-me` is complete, do not enter development strategy decisions, do not create or complete `design.md` / `implement.md`, and do not run `task.py start`.
Do not enter development strategy decisions until `prd.md` has been tightened through repository-first clarification and one-question-at-a-time follow-up.
Before `task.py start`, record the development strategy decisions in the task documents. Complex tasks should store them in `implement.md`: development mode (current session / subagent), branch vs worktree, default flow vs TDD, plus a single `A.` / `B.` / `C.` style strategy block that records the task-level selection for `trellis-spec-review`, `trellis-code-review`, `trellis-code-architecture-review`, `trellis-improve-codebase-architecture`, and `trellis-merge-review`. New tasks must stamp that block with `Review-gate contract: explicit-selection-v1`. Use `Optional review gates status: pending` only while the choice is still open; before `task.py start`, replace it with `Optional review gates status: configured` plus explicit `Enabled optional review gates:` and `Disabled optional review gates:` lists. If the user does not select any optional gate, still record all five in the disabled list and keep `trellis-check` fixed outside the optional set. Only tasks that entirely lack `Review-gate contract: explicit-selection-v1` count as legacy tasks and preserve the old behavior; if the marker exists but the configured enabled/disabled lists are missing, planning is incomplete and the task must not start. `trellis-improve-codebase-architecture` deep-review requires `trellis-code-architecture-review`; do not record or accept deep-review without that prerequisite gate. If the strategy is `subagent + worktree`, pin the shared path to `./.trellis/trellis-worktrees/<task-dir-name>` and require every code-development subagent to use it. If the strategy is TDD, record `trellis-tdd` as the reference flow. Record whether to run pre-development architecture guidance in that same strategy block. If guidance is enabled, record `架构审查：enabled` in `implement.md`, dispatch `trellis-improve-codebase-architecture` with `架构审查模式: guidance` before `task.py start`, and append its output to `design.md`, but do NOT implicitly enable `trellis-improve-codebase-architecture` deep-review; that gate still requires explicit selection in the same task-level review-gate set.
[/workflow-state:planning]

<!-- Per-turn breadcrumb: shown throughout Phase 1 when codex.dispatch_mode=inline.
     Codex-only opt-in alternate to [workflow-state:planning]. The main agent
     edits code directly in Phase 2, so jsonl curation is skipped —
     the inline workflow loads `trellis-before-dev` instead of injecting JSONL
     into a sub-agent. -->

[workflow-state:planning-inline]
Load `trellis-brainstorm`; stay in planning.
Lightweight: `prd.md` can be enough. Complex: finish `prd.md`, `design.md`, and `implement.md`; ask for review before `task.py start`.
Multi-deliverable scope: consider a parent task plus independently verifiable child tasks; dependencies must be written in child artifacts, not implied by tree position.
Inline mode: skip jsonl curation; Phase 2 reads artifacts/specs via `trellis-before-dev`.
[/workflow-state:planning-inline]

### Phase 2: Execute
- 2.1 Implement `[required · repeatable]`
- 2.2 Quality check `[required · repeatable]`
- 2.3 Rollback `[on demand]`

<!-- Per-turn breadcrumb: shown while status='in_progress'.
     Scope: all of Phase 2 + Phase 3.1-3.5 (status stays 'in_progress' from
     task.py start until task.py archive; only archive flips it). The body
     therefore must cover every required step from implementation through
     merge / final verification, including Phase 3.3 spec update, any
     Phase 3.4 commit guidance when a commit is actually needed, and Phase 3.5
     build/test plus optional `trellis-merge-review` when enabled. -->

Sub-agent dispatch protocol applies to all platforms and all sub-agents, including class-2 Codex/Copilot/Gemini/Qoder and `trellis-research`: every dispatch prompt starts with `Active task: <task path from task.py current>` before role-specific instructions.

[workflow-state:in_progress]
Flow: `trellis-implement` -> `trellis-check` -> `trellis-update-spec` -> archive or commit as needed -> merge if needed -> optional `trellis-merge-review` -> build/test -> `/trellis:finish-work`.
Claude Code optional review gates: if the task artifacts carry `Review-gate contract: explicit-selection-v1`, preserve the configured selection. Keep any enabled `trellis-spec-review`, `trellis-code-review`, and `trellis-code-architecture-review` in that order, run `trellis-improve-codebase-architecture` and `trellis-merge-review` only when the task strategy explicitly enables them, and keep `trellis-check` fixed outside this optional set. New tasks that use this contract must record `Optional review gates status: configured` plus explicit enabled/disabled lists; if the user picks none, record all five optional gates as disabled. Only tasks that entirely lack the contract marker count as legacy tasks and preserve the old behavior.
Main-session default: dispatch implement/check sub-agents. Sub-agent self-exemption: if already running as `trellis-implement`, do NOT spawn another `trellis-implement` or `trellis-check`; if already running as `trellis-check`, do NOT spawn another `trellis-check` or `trellis-implement`. Dispatch is main session only.
Dispatch prompt starts with `Active task: <task path from task.py current>`. Read context: jsonl entries -> `prd.md` -> `design.md if present` -> `implement.md if present`.

Claude review gates are read-only gates. They report PASS / FAIL, blocking issues, and suggested next actions; they do not modify code directly.
If a Claude review gate fails, the main agent repairs the code, then re-runs the same gate before advancing.
For any enabled `trellis-spec-review`, `trellis-code-review`, `trellis-code-architecture-review`, and `trellis-merge-review`, count repeated failures per gate and per task. If the same gate blocks the same task more than 3 times in a row, the main agent must briefly report that status to the user, re-check whether the requirements have drifted, and ask whether to skip the current review gate.
If the chosen strategy is `subagent + worktree`, all code-development subagents must use the same `./.trellis/trellis-worktrees/<task-dir-name>` path.
If the chosen strategy is TDD, align implementation and review expectations to `trellis-tdd`.
If the task strategy enables `trellis-improve-codebase-architecture` and the work is architecture-sensitive or enters structural refactoring, route the architecture pass through `trellis-improve-codebase-architecture` before widening the change.
If the task strategy enables `trellis-improve-codebase-architecture`, after `trellis-code-architecture-review` passes dispatch `trellis-improve-codebase-architecture` with `架构审查模式: deep-review` plus the changed file list from `git diff --name-only <base_branch>...HEAD`. On failure, report blocking issues and return to `trellis-implement`; re-run the full review loop until deep-review passes. `trellis-improve-codebase-architecture` deep-review requires `trellis-code-architecture-review`; if the task artifacts enable deep-review without that prerequisite gate, treat the strategy record as invalid and repair the task artifacts before continuing. Guidance recorded in `implement.md` is independent and does not by itself enable or block deep-review.
If the user asks to archive the current task, do not block on commit; archive is allowed even when code is not committed.
[/workflow-state:in_progress]

<!-- Per-turn breadcrumb: shown while status='in_progress' when
     codex.dispatch_mode=inline. Codex-only opt-in alternate to
     [workflow-state:in_progress]. The main session edits code directly
     instead of dispatching sub-agents. -->

[workflow-state:in_progress-inline]
Flow: `trellis-before-dev` -> edit -> `trellis-check` -> validation -> `trellis-update-spec` -> archive or commit as needed -> `/trellis:finish-work`.
Do not dispatch implement/check sub-agents in inline mode.
Read context: `prd.md` -> `design.md if present` -> `implement.md if present`, plus relevant spec/research loaded by skills.
If the user asks to archive the current task, do not block on commit; archive is allowed even when code is not committed.
[/workflow-state:in_progress-inline]

### Phase 3: Finish
- 3.1 Quality verification `[required · repeatable]`
- 3.2 Debug retrospective `[on demand]`
- 3.3 Spec update `[required · once]`
- 3.4 Commit changes `[optional · once]`
- 3.5 Merge & Final Verification `[required · once]`
- 3.6 Wrap-up reminder

<!-- Per-turn breadcrumb: shown while status='completed'.
     Currently DEAD in normal flow: cmd_archive writes status='completed' in
     the same call that moves the task dir to archive/, so the active-task
     resolver loses the pointer and the hook never fires on archived tasks.
     Block preserved for a future status-transition redesign (e.g. an
     explicit in_progress→completed command). Edit through the same spec
     channel as the live blocks. -->

[workflow-state:completed]
Task archived or code committed. Run `/trellis:finish-work`; if more validation or wrap-up is needed, do that before closing the work.
[/workflow-state:completed]

### Rules

1. 先判断当前处于哪个 Phase，再从该 Phase 的下一步继续
2. 每个 Phase 内按顺序执行；`[required]` 步骤不能跳过
3. Phase 允许回滚（例如 Execute 发现 prd 缺陷 → 回到 Plan 修正，再重新进入 Execute）
4. 标记为 `[once]` 的步骤，如果产物已存在则跳过，不要重复执行
5. 产物是否存在会影响下一步判断；轻量任务缺少 `design.md` / `implement.md` 是正常的，复杂任务则代表 planning 未完成

### Active Task Routing

当用户请求发生在一个活动任务里时，先按意图路由，再按需加载详细步骤说明。

[Claude Code, Cursor, OpenCode, codex-sub-agent, Kiro, Gemini, Qoder, CodeBuddy, Copilot, Droid, Pi]

- Planning 或需求未清晰 -> `trellis-brainstorm`。
- `in_progress` 的实现 / 检查 -> 分派 `trellis-implement` / `trellis-check`。
- 重复调试 -> `trellis-break-loop`；spec 更新 -> `trellis-update-spec`。

[/Claude Code, Cursor, OpenCode, codex-sub-agent, Kiro, Gemini, Qoder, CodeBuddy, Copilot, Droid, Pi]

[codex-inline, Kilo, Antigravity, Windsurf]

- Planning 或需求未清晰 -> `trellis-brainstorm`。
- 编辑前 -> `trellis-before-dev`；编辑后 -> `trellis-check`。
- 重复调试 -> `trellis-break-loop`；spec 更新 -> `trellis-update-spec`。

[/codex-inline, Kilo, Antigravity, Windsurf]

### Guardrails

- 用户同意创建任务，不等于同意开始实现；只有在产物 review 完成并执行 `task.py start` 后，才能进入实现。
- 轻量任务允许只有 PRD；复杂任务必须有 `design.md` + `implement.md`。
- planning 必须落盘到任务产物；完成前必须跑检查。

### Loading Step Detail

在每一步，你都可以运行下面命令读取详细指导：

```bash
python3 ./.trellis/scripts/get_context.py --mode phase --step <step>
# 例如：python3 ./.trellis/scripts/get_context.py --mode phase --step 1.1
```

---

## Phase 1: Plan

目标：对请求分类，在需要任务时取得创建任务的同意，并产出进入实现前所需的 planning 产物。

#### 1.0 Create task `[required · once]`

只有在获得 task-creation consent 后才能创建任务目录。该命令会设置 `planning` 状态、写入 `task.json`、创建默认 `prd.md`，并在有会话身份时自动把新任务设为当前目标：

```bash
python3 ./.trellis/scripts/task.py create "<任务标题>" --slug <name>
```

`--slug` 只填写人类可读的名称。**不要**带 `MM-DD-` 日期前缀；`task.py create` 会自动添加此前缀。

对于任务树，先创建父任务，再用 `--parent <parent-dir>` 创建各个子任务。不要因为子任务已存在就启动父任务；应该启动拥有下一个可独立验证交付物的那个子任务。

命令成功后，每回合 breadcrumb 会自动切换到 `[workflow-state:planning]`，提醒 AI 留在 planning 阶段。

这里仅运行 `create` —— 不要同时运行 `start`。`start` 会把状态切到 `in_progress`，导致 breadcrumb 在 planning 产物 review 前就切到实现阶段。把 `start` 留到 1.4。

若 `python3 ./.trellis/scripts/task.py current --source` 已指向某个任务，则跳过本步。

#### 1.1 Requirement exploration `[required · repeatable]`

加载 `trellis-brainstorm` skill，并按该 skill 的指导与用户交互式澄清需求。

brainstorm skill 会指导你：
- 一次只问一个问题
- 能靠调研回答的就先调研，不要先问用户
- 优先给选项，而不是纯开放式提问
- 用户每次回答后立刻更新 `prd.md`
- 当交付物可独立验证时，把大范围拆成父任务 + 子任务
- 保持 `prd.md` 只记录需求和验收标准
- 对复杂任务，在实现开始前产出 `design.md` 和 `implement.md`

当考虑父 / 子任务拆分时：
- When considering a parent/child split:
- 当一个请求包含多个可独立验证的交付物时，使用父任务。
- Parent tasks own source requirements, child-task mapping, cross-child acceptance criteria, and final integration review.
- 子任务负责那些可以独立 planning、implement、check 与 archive 的真实交付物。Child tasks own actual deliverables that can be planned, implemented, checked, and archived independently.
- Parent/child structure is not a dependency system. 如果子任务 B 依赖子任务 A，应把顺序写在子任务 B 的 `prd.md` / `implement.md` 里。
- 启动拥有下一个交付物的子任务。Do not start the parent unless the parent itself has direct implementation work.

在 Claude Code 路径进入实现前，把开发策略决策写入任务文档。
- 轻量任务可以把这些记录写在 `prd.md`。
- 复杂任务应把这些策略、task-local review-gate 选择，以及任何已启用 Claude review gate 的保序执行顺序写在 `implement.md`。
- 需要在同一个 `A.` / `B.` / `C.` 风格策略块里记录：当前会话 vs subagent、当前分支 vs worktree、默认流程 vs TDD、是否启用 pre-development architecture guidance，以及 `trellis-spec-review`、`trellis-code-review`、`trellis-code-architecture-review`、`trellis-improve-codebase-architecture`、`trellis-merge-review` 的任务级选择。
- 新任务必须在这个策略块里写入 `Review-gate contract: explicit-selection-v1`。
- 当选择尚未完成时，可以临时写 `Optional review gates status: pending`；在 `task.py start` 前必须改成 `Optional review gates status: configured`，并显式写出 `Enabled optional review gates:` / `Disabled optional review gates:`。
- 如果用户没有选中任何可选 gate，也要把这 5 个 gate 全部写进 disabled 列表；`trellis-check` 固定保留在这组之外。
- 只有完全缺少 `Review-gate contract: explicit-selection-v1` 标记的任务才视为 legacy task，并沿用旧行为；如果标记已存在但缺少 configured 的 enabled/disabled 列表，说明 planning 未完成，不能启动任务。
- `trellis-improve-codebase-architecture` deep-review 依赖 `trellis-code-architecture-review`；不要记录或接受只开 deep-review、不开号 architecture-review 的组合。
- 如果选择 `subagent + worktree`，将 `./.trellis/trellis-worktrees/<task-dir-name>` 固定为所有代码开发子代理共享的路径。
- 如果选择 TDD，记录 `trellis-tdd` 作为参考流程，并让后续实现与评审都对齐到它。
- 如果启用了 pre-development architecture guidance，在 `task.py start` 之前运行 `trellis-improve-codebase-architecture` guidance 并把结果追加到 `design.md`；但这不会隐式开启 `trellis-improve-codebase-architecture` deep-review，后者仍需在 review-gate 选择里显式启用。

每当需求变化，就回到此步骤并修订相关产物。

#### 1.2 Research `[optional · repeatable]`

在需求澄清期间，研究可以随时发生。它不局限于本地代码——你可以用任何可用工具（MCP servers、skills、web search 等）查询外部信息，包括第三方库文档、行业实践、API 参考等。

[Claude Code, Cursor, OpenCode, codex-sub-agent, Kiro, Gemini, Qoder, CodeBuddy, Copilot, Droid, Pi]

分派 research 子代理：

- **Agent type**: `trellis-research`
- **Task description**: Research <specific question>
- **Key requirement**: 研究结果**必须**落盘到 `{TASK_DIR}/research/`

[/Claude Code, Cursor, OpenCode, codex-sub-agent, Kiro, Gemini, Qoder, CodeBuddy, Copilot, Droid, Pi]

[codex-inline, Kilo, Antigravity, Windsurf]

在主会话中直接做研究，并把结果写入 `{TASK_DIR}/research/`。（对 `codex-inline` 而言，这可避开 `fork_turns="none"` 隔离带来的 active task 路径无法解析问题。）

[/codex-inline, Kilo, Antigravity, Windsurf]

**研究产物约定**：
- 每个研究主题一个文件（例如 `research/auth-library-comparison.md`）
- 把第三方库用法示例、API 参考、版本约束写进文件
- 记下你发现的相关 spec 文件路径，供后续引用

brainstorm 和 research 可以自由交错 —— 可以先停下来研究某个技术问题，再回来继续与用户收敛。

**关键原则**：研究结果必须写入文件，不能只留在对话里。对话会被压缩，文件不会。

#### 1.3 Configure context `[required · once]`

[Claude Code, Cursor, OpenCode, codex-sub-agent, Kiro, Gemini, Qoder, CodeBuddy, Copilot, Droid, Pi]

整理 `implement.jsonl` 和 `check.jsonl`，让 Phase 2 的子代理拿到正确的 spec / research 上下文。这两个文件会在 `task create` 时带着一条自描述 `_example` 种子行创建；你此时的工作是补上真实条目。

**位置**：`{TASK_DIR}/implement.jsonl` 和 `{TASK_DIR}/check.jsonl`（文件已存在）。

**格式**：每行一个 JSON 对象 —— `{"file": "<path>", "reason": "<why>"}`。路径相对于仓库根目录。

**应该放什么**：
- **Spec 文件** —— `.trellis/spec/<package>/<layer>/index.md` 以及与本任务相关的具体规范文件（`error-handling.md`、`conventions.md` 等）
- **Research 文件** —— `{TASK_DIR}/research/*.md` 中实现 / 检查子代理需要查看的文件

**不要放什么**：
- 代码文件（`src/**`、`packages/**/*.ts` 等）—— 这些文件由子代理在实现时自己读取，不要提前登记
- 你即将修改的文件 —— 原因相同

**两个文件怎么分工**：
- `implement.jsonl` → 实现子代理写代码时需要的 spec + research
- `check.jsonl` → 检查子代理需要的 spec（质量规范、检查约定，以及必要时相同的 research）

这些 manifest 不能替代 `implement.md`。`implement.md` 是复杂任务的人类可读执行计划；jsonl 只负责列出需注入或加载的上下文文件。

**如何发现相关 spec**：

```bash
python3 ./.trellis/scripts/get_context.py --mode packages
```

它会列出每个 package 及其 spec layer 路径。选出与本任务领域匹配的那些条目。

**如何追加条目**：

可以直接编辑 jsonl 文件，也可以使用：

```bash
python3 ./.trellis/scripts/task.py add-context "$TASK_DIR" implement "<path>" "<reason>"
python3 ./.trellis/scripts/task.py add-context "$TASK_DIR" check "<path>" "<reason>"
```

真实条目写入后，可删除 `_example` 种子行（可选——消费者会自动跳过它）。

如果 `implement.jsonl` 和 `check.jsonl` 已有 AI 整理过的真实条目（仅有种子行不算），则跳过。

[/Claude Code, Cursor, OpenCode, codex-sub-agent, Kiro, Gemini, Qoder, CodeBuddy, Copilot, Droid, Pi]

[codex-inline, Kilo, Antigravity, Windsurf]

跳过本步。上下文会在 Phase 2 由 `trellis-before-dev` skill 直接读取。

[/codex-inline, Kilo, Antigravity, Windsurf]

#### 1.4 Activate task `[required · once]`

在产物 review 完成后，把任务状态切到 `in_progress`：

```bash
python3 ./.trellis/scripts/task.py start <task-dir>
```

对于轻量任务，`prd.md` 可以足够。对于复杂任务，必须先存在并 review 完成 `prd.md`、`design.md` 和 `implement.md`。在 Claude Code 路径下，只有当任务文档已经记录开发策略决策后才能 start；复杂任务应把这些记录、enabled/disabled 的 review-gate 选择，以及任何已启用 Claude review gate 的保序执行顺序写在 `implement.md` 中，轻量任务则可写在 `prd.md` 中。对于支持子代理的平台，当任务需要额外 spec / research 上下文时，应整理 jsonl manifest；仅含种子行的 manifest 也会被消费者容忍，但不算真正完成该步。

命令成功后，breadcrumb 会自动切换到 `[workflow-state:in_progress]`，后续 Phase 2 / 3 将按此继续。

如果 `task.py start` 因缺少会话身份而报错（hook 输入、`TRELLIS_CONTEXT_ID` 或平台原生会话环境变量都未提供上下文 key），按报错提示先补上会话身份，再重试。

#### 1.5 Completion criteria

| Condition | Required |
|------|:---:|
| `prd.md` exists | ✅ |
| 用户确认任务可以进入实现 | ✅ |
| 已执行 `task.py start`（status = in_progress） | ✅ |
| 开发策略决策已在 start 前写入任务文档 | ✅ |
| `research/` 已有产物（复杂任务） | recommended |
| `design.md` exists（复杂任务） | ✅ |
| `implement.md` exists（复杂任务） | ✅ |

[Claude Code, Cursor, OpenCode, codex-sub-agent, Kiro, Gemini, Qoder, CodeBuddy, Copilot, Droid, Pi]

| 在需要额外 spec / research 上下文时，`implement.jsonl` / `check.jsonl` 已整理 | recommended |

[/Claude Code, Cursor, OpenCode, codex-sub-agent, Kiro, Gemini, Qoder, CodeBuddy, Copilot, Droid, Pi]

---

## Phase 2: Execute

目标：把经过 review 的 planning 产物落实成能通过质量检查的代码。

#### 2.1 Implement `[required · repeatable]`

[Claude Code, Cursor, OpenCode, Gemini, Qoder, CodeBuddy, Copilot, Droid, Pi]

分派 implement 子代理：

- **Agent type**: `trellis-implement`
- **Task description**: Implement the reviewed task artifacts, consulting materials under `{TASK_DIR}/research/`; finish by running project lint and type-check
- **Dispatch prompt guard**: Tell the spawned agent it is already the `trellis-implement` sub-agent and must implement directly, not spawn another `trellis-implement` / `trellis-check`.
- **Claude Code permission note**: `trellis-implement` carries `permissionMode: acceptEdits` so the normal foreground implement path can edit without per-write confirmation. If the parent Claude session runs under a host-constrained mode such as `auto`, actual permission behavior still follows the host.
- **Claude Code worktree note**: Trellis shared `subagent + worktree` means the sub-agent should stay on `./.trellis/trellis-worktrees/<task-dir-name>`. This is different from Claude Code host isolation via `Agent(..., isolation: "worktree")`; when the two conflict, the Claude hook auto-removes that isolation input and reports the correction.

平台 hook / plugin 会自动处理：The platform hook/plugin auto-handles:
- 读取 `implement.jsonl`，把引用的 spec / research 文件注入子代理 prompt。Reads `implement.jsonl`, injecting referenced spec / research files into the sub-agent prompt.
- 注入 `prd.md`、`design.md if present`、`implement.md if present`

[/Claude Code, Cursor, OpenCode, Gemini, Qoder, CodeBuddy, Copilot, Droid, Pi]

[codex-sub-agent]

分派 implement 子代理：

- **Agent type**: `trellis-implement`
- **Task description**: Implement the reviewed task artifacts, consulting materials under `{TASK_DIR}/research/`; finish by running project lint and type-check
- **Dispatch prompt guard**: prompt **必须**以 `Active task: <task path>` 开头，然后显式说明该子代理已经是 `trellis-implement`，必须直接实现，不能再分派新的 `trellis-implement` / `trellis-check`。

Codex 子代理定义会自动处理上下文加载。The Codex sub-agent definition auto-handles context loading:
- 用 `task.py current --source` 解析活动任务，然后读取 `prd.md`、`design.md if present`、`implement.md if present`。Resolves the active task with `task.py current --source`, then reads task artifacts.
- 读取 `implement.jsonl`，并要求子代理在编码前加载每个引用的 spec / research 文件

[/codex-sub-agent]

[Kiro]

分派 implement 子代理：

- **Agent type**: `trellis-implement`
- **Task description**: Implement the reviewed task artifacts, consulting materials under `{TASK_DIR}/research/`; finish by running project lint and type-check
- **Dispatch prompt guard**: Tell the spawned agent it is already the `trellis-implement` sub-agent and must implement directly, not spawn another `trellis-implement` / `trellis-check`.

平台前置上下文会自动处理：
- 读取 `implement.jsonl`，把引用的 spec / research 文件注入 prompt
- 注入 `prd.md`、`design.md if present`、`implement.md if present`

[/Kiro]

[codex-inline, Kilo, Antigravity, Windsurf]

1. 加载 `trellis-before-dev` skill，先读项目规范
2. Read `{TASK_DIR}/prd.md`、`design.md if present`、`implement.md if present`
3. 查看 `{TASK_DIR}/research/` 下的材料
4. 按 review 通过的产物实现代码
5. 运行项目 lint 和 type-check

[/codex-inline, Kilo, Antigravity, Windsurf]

#### 2.2 Quality check `[required · repeatable]`

[Claude Code, Cursor, OpenCode, codex-sub-agent, Kiro, Gemini, Qoder, CodeBuddy, Copilot, Droid, Pi]

对于 Claude Code 路径，实现完成后按任务策略运行显式选中的 review gate。

- 若启用了 `trellis-spec-review`、`trellis-code-review`、`trellis-code-architecture-review`，保持这个顺序：

1. `trellis-spec-review`
2. `trellis-code-review`
3. `trellis-code-architecture-review`

- 如果任务文档带有 `Review-gate contract: explicit-selection-v1`，则严格按 `Optional review gates status: configured`、`Enabled optional review gates:`、`Disabled optional review gates:` 执行。
- `trellis-improve-codebase-architecture` 与 `trellis-merge-review` 只有在任务策略显式启用时才运行。
- 对新任务，如果用户没有选择任何可选 gate，也要把这 5 个 gate 全部显式写进 disabled 列表；`trellis-check` 继续固定保留。
- 只有完全缺少 `Review-gate contract: explicit-selection-v1` 标记的任务才视为 legacy task，并沿用旧行为。
- 如果标记已存在但缺少 configured 的 enabled/disabled 列表，或出现只开 `trellis-improve-codebase-architecture` deep-review、不启用 `trellis-code-architecture-review` 的组合，则任务策略无效，必须先修复任务文档再继续。

Do not advance to the next gate until the previous gate passes. Each enabled gate must review the code against `prd.md`, `design.md` if present, `implement.md` if present, and the relevant specs; on FAIL, the main agent fixes the blocking issues and re-runs the same gate before continuing.
If the same enabled gate blocks the same task more than 3 times in a row, the main agent must briefly report that status to the user, re-check whether the requirements have drifted, and ask whether to skip the current review gate.

如果当前平台还没有专用的 review-gate agent，则继续使用 `trellis-check` 作为兼容回退：

- **Agent type**: `trellis-check`
- **Task description**: Review all code changes against specs and task artifacts; report findings to the main session; ensure lint and type-check pass
- **Dispatch prompt guard**: Tell the spawned agent it is already the `trellis-check` sub-agent and must review/report directly, not spawn another `trellis-check` / `trellis-implement`.

check 子代理的职责：
- 对照 spec 审查代码改动
- 对照 `prd.md`、`design.md if present`、`implement.md if present` 审查代码改动
- 向主 agent 报告阻塞项和建议动作
- 运行 lint 和 typecheck 验证

[/Claude Code, Cursor, OpenCode, codex-sub-agent, Kiro, Gemini, Qoder, CodeBuddy, Copilot, Droid, Pi]

[codex-inline, Kilo, Antigravity, Windsurf]

加载 `trellis-check` skill，并按其指导验证代码：
- spec 合规性
- lint / type-check / tests
- 跨层一致性（当改动跨层时）

如有问题 → 修复 → 再检查，直到通过。

[/codex-inline, Kilo, Antigravity, Windsurf]

#### 2.3 Rollback `[on demand]`

- `check` 暴露出 prd 缺陷 → 回到 Phase 1，修正 `prd.md`，再重做 2.1
- 实现走偏 → 回滚代码，重做 2.1
- 需要更多研究 → 继续研究（同 Phase 1.2），并把结论写进 `research/`

---

## Phase 3: Finish

目标：确保代码质量、沉淀经验，并记录本次工作。

#### 3.1 Quality verification `[required · repeatable]`

加载 `trellis-check` skill，做最终验证：
- spec 合规性
- lint / type-check / tests
- 跨层一致性（当改动跨层时）

如有问题 → 修复 → 再检查，直到通过。

#### 3.2 Debug retrospective `[on demand]`

如果这个任务经历了重复调试（同一个问题被修了多次），加载 `trellis-break-loop` skill 来：
- 分类根因
- 解释为什么前面的修复会失败
- 提出预防方案

目标是把调试经验沉淀下来，避免同类问题再次发生。

#### 3.3 Spec update `[required · once]`

加载 `trellis-update-spec` skill，评估这次任务是否产生了值得记录的新知识：
- 新发现的模式或约定
- 踩过的坑
- 新的技术决策

相应更新 `.trellis/spec/` 下的文档。即使结论是“这次没有内容要更新”，也要走完判断过程。

#### 3.4 Commit changes `[required · once]`

AI 会驱动一次按批次组织的提交，让 `/finish-work` 后续能在干净状态下运行。目标：先产出工作提交，再产出收尾性的 archive + journal 提交，绝不交错。

**Step-by-step**：

1. **检查脏状态**：
   ```bash
   git status --porcelain
   ```
   记录所有脏文件路径。如果工作树干净，直接跳到 3.5。

2. **学习提交风格**，从最近历史里判断惯例（方便拟定风格一致的 commit message）：
   ```bash
   git log --oneline -5
   ```
   注意前缀风格（`feat:` / `fix:` / `chore:` / `docs:` ...）、语言（中文 / English）以及长度习惯。

3. **把脏文件分两类**：
   - **本会话 AI 改过的文件** —— 你通过 Edit / Write / Bash 工具改过，知道改动原因。
   - **未识别文件** —— 本会话没碰过的脏文件（可能是用户手动改的、上一次遗留的 WIP，或无关工作）。不要静默把这些文件带进提交。

4. **拟定提交计划**。把本会话 AI 改过的文件按“连贯改动单元”分组（一个逻辑改动一个 commit，而不是一文件一 commit）。每组写成：`<commit message>` + 文件列表。未识别文件单独列在底部。

5. **一次性展示计划，并请求一次性确认**。格式：
   ```
   Proposed commits (in order):
     1. <message>
        - <file>
        - <file>
     2. <message>
        - <file>

   Unrecognized dirty files (NOT in any commit — confirm include/exclude):
     - <file>
     - <file>

   Reply 'ok' / '行' to execute. Reply with edits, or '我自己来' / 'manual' to abort.
   ```

6. **得到确认后**：按顺序对每一组执行 `git add <files>` + `git commit -m "<msg>"`。不要 amend。不要 push。

7. **如果用户拒绝**（例如回复“不行” / “我自己来” / “manual”，或对分组方案有异议）：立即停止。不要再给第二版提交计划。用户将自行提交；待其确认后，你再跳到 3.5。

**Rules**：
- 全程禁止 `git commit --amend` —— 保持“三阶段三提交”流（工作提交 → archive 提交 → journal 提交）。
- 这一阶段绝不能 push 到远端。
- 如果用户只是接受文件分组、但希望调整 message wording，可以修改 message 并再确认一次；但如果用户否定了分组本身，就退出到 manual 模式。
- 这个 batched plan 只问一次，不要每个 commit 单独确认。

#### 3.5 Merge & Final Verification `[required · once]`

代码已提交。执行合并并做最终验收，确认需求真正落地。

**Step-by-step**：

1. **判断是否需要合并**：
   - 如果开发策略是 `subagent + worktree` 或 feature branch，执行合并（`git merge` 到主分支，或通过 PR 合并）。
   - 如果策略是"当前分支直接开发"（无独立分支），跳过合并，直接进入第 2 步。

2. **如果任务策略启用了 `trellis-merge-review`，dispatch `trellis-merge-review` agent**，检查合并结果：
   - 无合并冲突残留
   - 无遗漏文件
   - 合并目标分支状态与 `prd.md` 验收标准对齐
   - `trellis-merge-review` 只负责只读审查与阻塞报告，不直接修复合并结果。
   - 如果 `trellis-merge-review` 返回 FAIL，由主 agent 修复问题后重新执行此步骤；若同一 gate 在同一任务中连续阻塞超过 3 次，由主 agent 升级给用户重新核对需求并询问是否跳过当前 review。

3. **编译 + 测试**：如果启用了 `trellis-merge-review`，则在该 gate 返回 PASS 后执行；如果未启用，则在合并完成后直接执行项目的编译命令与完整测试套件。
   - 编译 + 测试全部通过，才允许进入 3.6。
   - 如有失败，修复后重新从第 2 步开始。

#### 3.6 Wrap-up reminder

完成上述步骤后，提醒用户可以运行 `/finish-work` 来收尾（archive task、记录 session）。

---

## Customizing Trellis (for forks)

本节面向想修改 Trellis 工作流本身的开发者。所有定制都通过编辑此文件完成；脚本只负责解析，不持有业务语义。

### Changing what a step means

直接编辑上面 Phase 1 / 2 / 3 中对应步骤的 walkthrough 内容。关键不变量：
- 没有活动任务时，必须先做请求分流，并在创建 Trellis 任务前征得 task-creation consent。
- planning 必须区分：轻量 PRD-only 任务 vs 需要在 start 前补齐 `prd.md`、`design.md`、`implement.md` 的复杂任务。
- 每条 required 的执行路径都必须保留通往 Phase 3.4 commit 提醒与 Phase 3.5 merge/final verification 的可达性，不能在 `/trellis:finish-work` 前丢失。

所有 tag block 都位于上方 `## Phase Index` 区域、紧跟在各阶段摘要之后：

| Scope | Corresponding tag |
|---|---|
| 无活动任务（Phase 1 之前） | `[workflow-state:no_task]`（位于 Phase Index ASCII art 之后） |
| Phase 1 全阶段（任务已创建 → 准备进入实现） | `[workflow-state:planning]`（位于 Phase 1 摘要之后） |
| Codex inline 的 Phase 1 | `[workflow-state:planning-inline]` |
| Phase 2 + Phase 3.1–3.5（实现 + 检查 + 收尾） | `[workflow-state:in_progress]`（位于 Phase 2 摘要之后） |
| Codex inline 的 Phase 2 + Phase 3.1–3.5 | `[workflow-state:in_progress-inline]` |
| Phase 3.5 之后（已 archive） | `[workflow-state:completed]`（位于 Phase 3 摘要之后；**currently DEAD**） |

### Changing the per-turn prompt text

直接编辑对应 `[workflow-state:STATUS]` block 的内容即可。编辑后，若你是模板维护者，运行 `trellis update`；若你是在定制自己的项目，重启 AI 会话即可 —— 无需改脚本。

### Adding a custom status

新增一个 block：

```
[workflow-state:my-status]
your per-turn prompt text
[/workflow-state:my-status]
```

约束：
- STATUS 字符集：`[A-Za-z0-9_-]+`（允许下划线和连字符，例如 `in-review`、`blocked-by-team`）
- 必须有生命周期 hook 把 `task.json.status` 写成你的自定义值，否则这个 tag 永远不会被读取
- 生命周期 hooks 写在 `task.json.hooks.after_*` 下，并绑定到 `after_create / after_start / after_finish / after_archive` 之一

### Adding a lifecycle hook

在 `task.json` 中新增 `hooks` 字段：

```json
{
  "hooks": {
    "after_finish": [
      "your-script-or-command-here"
    ]
  }
}
```

支持事件：`after_create / after_start / after_finish / after_archive`。注意 `after_finish` **不等于**状态切换（它只是清除 active-task 指针）；如果你想表达“任务完成”，请使用 `after_archive`。

### Full contract

关于工作流状态机的运行时契约、所有 status writer 位置、伪状态（`no_task` / `stale_<source_type>`）、hook 可达性矩阵等更深细节，请查看：

- `.trellis/spec/cli/backend/workflow-state-contract.md` —— 运行时契约 + writer 表 + 测试不变量
- `.trellis/scripts/inject-workflow-state.py` —— 实际解析器（只读 workflow.md，不内嵌文本）
