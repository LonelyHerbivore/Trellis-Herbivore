# Trellis Grill Me

Use this skill after the initial repository-first clarification pass, when the task still has requirement gaps that only the user can answer.

## Purpose

Drive a strict follow-up interview to tighten `prd.md` before implementation starts.

This is the Trellis-built-in replacement for external `grill-me` dependency patterns. Do not rely on any local third-party skill path.

## Entry Conditions

Use this skill only when:
- a Trellis task already exists
- repository-answerable questions have already been resolved through inspection
- the remaining uncertainty is about product intent, scope, preferences, trade-offs, or risk tolerance

Do **not** use this skill for questions the codebase can answer directly.

## Interview Contract

- Ask one question at a time.
- Each question must include:
  - the exact decision needed
  - why it matters
  - your recommended answer
  - what trade-off the user accepts if they choose differently
- After each answer, update `prd.md` before asking the next question.
- Stop once `prd.md` has converged enough to enter development-strategy decisions.

## Questioning Style

Push for missing details across these dimensions when relevant:
- user-visible behavior
- scope boundaries
- success / failure behavior
- edge cases
- sequencing and rollout expectations
- what is explicitly out of scope
- what would make the user reject the implementation even if it "works"

Prefer concrete trade-offs over generic brainstorming.

## Output Standard

By the time this skill is done:
- `prd.md` has testable acceptance criteria
- unresolved questions are truly strategic, not factual
- implementation can move on to development mode / worktree / TDD decisions
