---
name: trellis-brainstorm
description: "Guides collaborative requirements discovery before implementation. Creates task directory, seeds PRD, asks high-value questions one at a time, researches technical choices, and converges on MVP scope. Use when requirements are unclear, there are multiple valid approaches, or the user describes a new feature or complex task."
---

# Trellis Brainstorm

## Non-Negotiable Interview Contract

Interview me relentlessly about every aspect of this plan until we reach a shared understanding. Walk down each branch of the design tree, resolving dependencies between decisions one-by-one. For each question, provide your recommended answer.

Ask the questions one at a time.

Do not compress brainstorm into a single summary plus design draft. A complex feature needs multiple decision rounds. Each round must resolve one product or scope decision, then update the task artifact before continuing.

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
TASK_DIR=$(python3 ./.trellis/scripts/task.py create "<short task title>" --slug <slug>)
```

Use a concise title from the user's request. Use a slug without a date prefix. `task.py create` adds the `MM-DD-` directory prefix automatically.

`task.py create` creates the default `prd.md`. Update that file with the current understanding before asking follow-up questions.

## Planning Flow

1. Capture the user's request and initial known facts in `prd.md`.
2. Run an evidence pass before asking questions:
   - code, tests, fixtures, and configs
   - README files, docs, existing specs, and domain notes
   - related Trellis tasks, research files, and session history when present
   - GitNexus / abcoder / repo-index tools when they are available and the task changes code structure, package boundaries, or call flows
   - existing parent/child task structure when the request appears to contain multiple deliverables
3. Write an evidence note into the task before asking the first question. Use `prd.md` for lightweight tasks; use `research/` for larger evidence. Include:
   - files / symbols / flows inspected
   - confirmed facts
   - repository-answerable questions already resolved
   - remaining product decisions that only the user can answer
4. Separate what you found into:
   - confirmed facts
   - product intent still needed from the user
   - scope or risk decisions still needed from the user
   - likely out-of-scope items
5. Ask the single highest-value remaining question.
6. Include your recommended answer with the question.
7. After each user answer, update `prd.md` before continuing.
8. Record a short brainstorm round note in `prd.md` or `research/brainstorm.md`.
9. For complex tasks, do not create or update `design.md` as a final design until evidence is recorded and at least three decision rounds have completed, unless the user explicitly says the scope is already settled.
10. For complex tasks, create or update `design.md` and `implement.md` before implementation starts.

If the request contains multiple independently verifiable deliverables, propose a parent task plus child tasks. Parent tasks own the source requirements, child map, cross-child acceptance, and final integration review. Child tasks own the actual deliverables. Do not use the parent/child tree as an implicit dependency model; write dependency ordering in each affected child `prd.md` / `implement.md`.

Do not invent a project-specific product/spec hierarchy. If the repository already has product, domain, or spec docs, use them. If it does not, proceed with the evidence that exists.

## Evidence Gate

Before the first user question, run and record the relevant evidence.

For codebase changes, include at least:

- content search for the feature names and adjacent terminology
- file reads for the main implementation and tests
- existing specs or task docs that govern the area
- GitNexus impact/context for shared symbols, public APIs, route handlers, package boundaries, or call-chain-sensitive changes when GitNexus is available
- abcoder AST inspection for symbol-level structure when GitNexus is incomplete or a single-file AST view is useful

If a tool is unavailable or returns low-quality results, say that in the evidence note and use the next-best repository evidence. Do not silently skip the evidence gate.

## Brainstorm Round Ledger

Maintain a visible ledger in the task artifact for complex tasks:

```md
## Brainstorm Rounds

1. Decision: ...
   Evidence: ...
   User answer: ...
   Resulting requirement: ...
```

The ledger prevents one-shot "brainstorm" behavior. A complex task is not ready for design review until the ledger shows the important product branches have been walked.

## Question Rules

Ask only one question per message.

Each question must include:

- the decision needed
- why the answer matters
- your recommended answer
- the trade-off if the user chooses differently

Do not ask process questions such as whether to search, inspect files, or continue brainstorming. Do the evidence work directly. Ask the user only when the remaining issue is a product decision, preference, scope boundary, or risk tolerance choice.

When asking, use this shape:

```md
Decision: ...
Why it matters: ...
Recommended answer: ...
Trade-off if different: ...
Question: ...
```

Do not ask a question whose answer is already present in code, docs, tests, specs, task history, or tool-index output.

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

- ordered implementation checklist
- validation commands
- risky files or rollback points
- follow-up checks before `task.py start`

Lightweight tasks may have only `prd.md`. Complex tasks must have `prd.md`, `design.md`, and `implement.md` before `task.py start`.

`implement.md` is not a replacement for `implement.jsonl`. Use JSONL files only for manifest-style spec and research references when the task needs them.

For complex tasks, mark early `design.md` / `implement.md` as drafts if they are written before the brainstorm rounds finish. Do not present them as complete planning artifacts until the ledger and quality bar are satisfied.

## Quality Bar

Before declaring planning ready:

- `prd.md` contains testable acceptance criteria.
- Evidence pass is recorded in the task.
- Brainstorm round ledger exists for complex tasks and shows multiple resolved decisions, not just one summary.
- Repository-answerable questions have already been answered through inspection.
- Remaining open questions are genuinely about user intent or scope.
- Complex tasks have `design.md` and `implement.md`.
- The user has reviewed the final planning artifacts or explicitly approved proceeding.

Before writing a final design for a complex task, self-check:

- Did I use repository evidence before asking?
- Did I use GitNexus / abcoder when structural relationships matter and tools are available?
- Did I ask one product question at a time?
- Did each answer update the PRD or research ledger?
- Am I prematurely turning open product choices into implementation details?

Do not start implementation until the user approves or asks for implementation.
