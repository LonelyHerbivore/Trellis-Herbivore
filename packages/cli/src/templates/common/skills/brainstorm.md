# Trellis Brainstorm

## Non-Negotiable Interview Contract

Interview me relentlessly about every aspect of this plan until we reach a shared understanding. Walk down each branch of the design tree, resolving dependencies between decisions one-by-one. For each question, provide your recommended answer.

Ask the questions one at a time.

## Non-Negotiable Evidence Rule

If a question can be answered by exploring the codebase, explore the codebase instead.

This is mandatory. Before asking the user a question, first check whether the answer is already available in code, tests, configs, docs, existing specs, or task history.

Do not ask the user to confirm facts that the repository can answer. Ask only for product intent, preference, scope, risk tolerance, or decisions that remain ambiguous after inspection.

---

Use this skill during Phase 1 planning to turn the user's request into clear requirements and planning artifacts.

## Preconditions

Use this skill only after task-creation consent has been given and the user is ready to enter Trellis planning.

If no task exists yet, create one:

```bash
TASK_DIR=$({{PYTHON_CMD}} ./.trellis/scripts/task.py create "<short task title>" --slug <slug>)
```

Use a concise title from the user's request. Use a slug without a date prefix. `task.py create` adds the `MM-DD-` directory prefix automatically.

`task.py create` creates the default `prd.md`. Update that file with the current understanding before asking follow-up questions.

## Planning Flow

1. Capture the user's request and initial known facts in `prd.md`.
2. Inspect available evidence before asking questions:
   - code, tests, fixtures, and configs
   - README files, docs, existing specs, and domain notes
   - related Trellis tasks, research files, and session history when present
3. Separate what you found into:
   - confirmed facts
   - product intent still needed from the user
   - scope or risk decisions still needed from the user
   - likely out-of-scope items
4. Ask the single highest-value remaining question.
5. Include your recommended answer with the question.
6. After each user answer, update `prd.md` before continuing.
7. Once repository-answerable questions are exhausted, enter `trellis-grill-me` and tighten the remaining requirement gaps one question at a time, each with a recommendation, while still updating `prd.md` after each answer.
8. On the Claude Code path, `trellis-grill-me` is a required planning gate. Before it is complete, do not switch into development strategy decisions, do not create or complete `design.md` / `implement.md`, and do not run `task.py start`.
9. Before implementation starts on the Claude Code path, record the development strategy decisions in the task documents: development mode, branch vs worktree, default flow vs TDD, and the task-level review-gate selection. Ask these in a single `A.` / `B.` / `C.` style option block. New tasks must stamp that strategy block with `Review-gate contract: explicit-selection-v1`. Lightweight tasks may keep that record in `prd.md`; complex tasks should keep it in `implement.md` together with the enabled/disabled review gates and the preserved execution order for any enabled Claude review gates: `trellis-spec-review` → `trellis-code-review` → `trellis-code-architecture-review`. The selectable review gates are `trellis-spec-review`, `trellis-code-review`, `trellis-code-architecture-review`, `trellis-improve-codebase-architecture`, and `trellis-merge-review`. While the choice is still open, `Optional review gates status: pending` is allowed; before `task.py start`, replace it with `Optional review gates status: configured` plus explicit `Enabled optional review gates:` and `Disabled optional review gates:` lists. If the user leaves all optional gates off, still record all five in the disabled list; `trellis-check` stays fixed outside this set. Only tasks that entirely lack `Review-gate contract: explicit-selection-v1` count as legacy tasks and preserve the old behavior; if the marker exists but the configured enabled/disabled lists are missing, planning is incomplete and the task must not start. `trellis-improve-codebase-architecture` deep-review requires `trellis-code-architecture-review`, so do not record or accept the deep-review gate without that prerequisite. If the strategy is `subagent + worktree`, pin `./.trellis/trellis-worktrees/<task-dir-name>`. If the strategy is TDD, record `trellis-tdd` as the reference flow. Also record whether to run pre-development architecture guidance in that same strategy block. If guidance is enabled, record `架构审查：enabled`, dispatch `trellis-improve-codebase-architecture` with `架构审查模式: guidance` before `task.py start`, and append its output to `design.md`, but do NOT implicitly enable `trellis-improve-codebase-architecture` deep-review; that gate still requires explicit selection in the task-level review-gate set.
10. For complex tasks, create or update `design.md` and `implement.md` only after `trellis-grill-me` is complete and implementation is about to start.

Do not invent a project-specific product/spec hierarchy. If the repository already has product, domain, or spec docs, use them. If it does not, proceed with the evidence that exists.

## Question Rules

Ask only one question per message.

Each question must include:

- the decision needed
- why the answer matters
- your recommended answer
- the trade-off if the user chooses differently

Do not ask process questions such as whether to search, inspect files, or continue brainstorming. Do the evidence work directly. Ask the user only when the remaining issue is a product decision, preference, scope boundary, or risk tolerance choice.

## Artifact Rules

`prd.md` records requirements and acceptance:

- goal and user value
- confirmed facts
- requirements
- acceptance criteria
- out of scope
- open questions that still block planning

`design.md` records technical design for complex tasks:

- architecture and boundaries
- data flow and contracts
- compatibility and migration notes
- important trade-offs
- operational or rollback considerations

`implement.md` records execution planning for complex tasks:

- development strategy decisions
- review-gate selection and enabled-gate order
- ordered implementation checklist
- validation commands
- risky files or rollback points
- follow-up checks before `task.py start`

Lightweight tasks may have only `prd.md`. Complex tasks must have `prd.md`, `design.md`, and `implement.md` before `task.py start`.

`implement.md` is not a replacement for `implement.jsonl`. Use JSONL files only for manifest-style spec and research references when the task needs them.

## Quality Bar

Before declaring planning ready:

- `prd.md` contains testable acceptance criteria.
- Repository-answerable questions have already been answered through inspection.
- Remaining open questions are genuinely about user intent or scope.
- Complex tasks have `design.md` and `implement.md`.
- The user has reviewed the final planning artifacts or explicitly approved proceeding.

Do not start implementation until the user approves or asks for implementation.
