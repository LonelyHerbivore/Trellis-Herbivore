# Trellis TDD

Use this skill when the task's chosen development strategy is TDD, or when the user explicitly asks to work test-first.

## Purpose

Turn a task into observable behavior slices and drive implementation through failing tests first.

This is the Trellis-built-in replacement for external local TDD references. Do not rely on any local third-party skill path.

## Core Flow

1. Identify the smallest observable behavior slice.
2. Define the public interface under test.
3. Decide the mock boundaries before writing tests.
4. Write the failing test first.
5. Implement the smallest code change that makes it pass.
6. Refactor only after the test is green.
7. Repeat slice by slice.

## Rules

- Keep slices small and user-observable.
- Prefer testing public behavior over internal helpers.
- Do not batch multiple behavior changes into one red-green cycle.
- If a task artifact already records acceptance criteria, map tests back to them.
- Keep review gates aligned with the chosen TDD strategy.

## Output Standard

By the time this skill is done:
- tests lead the implementation order
- each behavior slice is backed by an explicit test
- the task artifacts clearly reflect TDD as the chosen strategy
