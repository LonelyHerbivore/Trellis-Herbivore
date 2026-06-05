# Start Session

Initialize a Trellis-managed development session. This platform has no session-start hook, so manually load the equivalent compact context by following these steps.

---

## Step 1: Current state
Identity, git status, current task, active tasks, journal location.

```bash
{{PYTHON_CMD}} ./.trellis/scripts/get_context.py
```

If this output includes a line beginning `Trellis update available:`, copy the full line verbatim when summarizing session context. Do not shorten operational command hints.

## Step 2: Workflow overview
Compact Phase Index, request triage rules, planning artifact contract, and the step-detail command.

```bash
{{PYTHON_CMD}} ./.trellis/scripts/get_context.py --mode phase
```

Full guide in `.trellis/workflow.md` (read on demand).

## Step 3: Guideline indexes
Discover packages + spec layers, then read each relevant index file.

```bash
{{PYTHON_CMD}} ./.trellis/scripts/get_context.py --mode packages
cat .trellis/spec/guides/index.md
cat .trellis/spec/<package>/<layer>/index.md   # for each relevant layer
```

Index files list the specific guideline docs to read when you actually start coding.

## Step 4: Decide next action
From Step 1 you know the current task and status. Check the task directory:

- **Active task status `planning` + no `prd.md`** → Phase 1.1. Load the `trellis-brainstorm` skill.
- **Active task status `planning` + `prd.md` exists** → stay in Phase 1. Lightweight tasks can be PRD-only; complex tasks need `design.md` + `implement.md`. For the Claude Code path, keep requirement clarification in `prd.md`, continue repository-first follow-up questioning by entering `trellis-grill-me`, and treat it as a required planning gate. Before `trellis-grill-me` is complete, do not enter development strategy decisions, do not create or complete `design.md` / `implement.md`, and do not run `task.py start`. Before `task.py start`, record the decisions in the task documents: development mode, branch vs worktree, default flow vs TDD, plus the task-level review-gate selection. Ask these in one `A.` / `B.` / `C.` style strategy block. New tasks must stamp that block with `Review-gate contract: explicit-selection-v1`. Complex tasks should keep that record in `implement.md` together with the enabled/disabled review gates and the preserved order for any enabled Claude review gates: `trellis-spec-review` → `trellis-code-review` → `trellis-code-architecture-review`. While the choice is still open, `Optional review gates status: pending` is allowed; before `task.py start`, replace it with `Optional review gates status: configured` plus explicit `Enabled optional review gates:` and `Disabled optional review gates:` lists for the selectable review gates (`trellis-spec-review`, `trellis-code-review`, `trellis-code-architecture-review`, `trellis-improve-codebase-architecture`, `trellis-merge-review`). If the user leaves all optional gates off, still record all five in the disabled list while keeping `trellis-check` fixed outside that set. Only tasks that entirely lack `Review-gate contract: explicit-selection-v1` count as legacy tasks and preserve the old behavior; if the marker exists but the configured enabled/disabled lists are missing, planning is incomplete and the task must not start. `trellis-improve-codebase-architecture` deep-review requires `trellis-code-architecture-review`; do not record or accept deep-review without that prerequisite gate. If the strategy is `subagent + worktree`, pin `./.trellis/trellis-worktrees/<task-dir-name>`. On Claude Code, that shared worktree is different from host `Agent(..., isolation: "worktree")`; when both collide, the hook removes the host isolation input before dispatch. If the strategy is TDD, record `trellis-tdd` as the reference flow. Also record whether to run pre-development architecture guidance in that same strategy block. If guidance is enabled, record `架构审查：enabled`, dispatch `trellis-improve-codebase-architecture` with `架构审查模式: guidance` before `task.py start`, and append its output to `design.md`, but do NOT implicitly enable `trellis-improve-codebase-architecture` deep-review; that gate still requires explicit selection in the task-level review-gate set.
- **Active task status `in_progress`** → Phase 2 step 2.1. Load the step detail:
  ```bash
  {{PYTHON_CMD}} ./.trellis/scripts/get_context.py --mode phase --step 2.1 --platform {{CLI_FLAG}}
  ```
- **No active task** → classify first. For simple conversation / small task, ask only whether this turn should create a Trellis task. For complex work, ask whether you may create a Trellis task and enter planning. If the user says no, skip Trellis for this session.

---

## Skill routing (quick reference)

| User intent | Skill |
|---|---|
| New feature / unclear requirements | `trellis-brainstorm` |
| About to write code | `trellis-before-dev` |
| Done coding / quality check | `trellis-check` |
| Stuck / fixed same bug multiple times | `trellis-break-loop` |
| Learned something worth capturing | `trellis-update-spec` |

Full rules + anti-rationalization table in `.trellis/workflow.md`.
