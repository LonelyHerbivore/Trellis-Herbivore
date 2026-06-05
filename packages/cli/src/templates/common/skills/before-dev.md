Read the relevant development guidelines before starting your task.

Execute these steps:

1. **Read current task artifacts**:
   - `prd.md` for requirements and acceptance criteria
   - `design.md` if present for technical design
   - `implement.md` if present for execution order and validation plan

2. **Discover packages and their spec layers**:
   ```bash
   python3 ./.trellis/scripts/get_context.py --mode packages
   ```

3. **Identify which specs apply** to your task based on:
   - Which package you're modifying (e.g., `cli/`, `docs-site/`)
   - What type of work (backend, frontend, unit-test, docs, etc.)
   - Any spec/research paths referenced by the task artifacts

4. **Read the spec index** for each relevant module:
   ```bash
   cat .trellis/spec/<package>/<layer>/index.md
   ```
   Follow the **"Pre-Development Checklist"** section in the index.

5. **Read the specific guideline files** listed in the Pre-Development Checklist that are relevant to your task. The index is NOT the goal — it points you to the actual guideline files (e.g., `error-handling.md`, `conventions.md`, `mock-strategies.md`). Read those files to understand the coding standards and patterns.

6. **Always read shared guides**:
   ```bash
   cat .trellis/spec/guides/index.md
   ```

7. If the task artifacts record a development strategy, follow it before writing code: keep `subagent + worktree` work on the shared `./.trellis/trellis-worktrees/<task-dir-name>` path, and if the task selected TDD, align your development flow to `trellis-tdd`.

8. If the task artifacts explicitly enable pre-development architecture guidance, run the task through `trellis-improve-codebase-architecture` guidance before widening the refactor. Architecture sensitivity or structural cleanup can justify recommending guidance during planning, but they do not implicitly enable it during execution.

9. If the task artifacts carry `Review-gate contract: explicit-selection-v1`, preserve the configured selection for the main session. Require `Optional review gates status: configured` plus explicit `Enabled optional review gates:` / `Disabled optional review gates:` lists, keep any enabled Claude review gates in this order: `trellis-spec-review` → `trellis-code-review` → `trellis-code-architecture-review`, treat `trellis-improve-codebase-architecture` and `trellis-merge-review` as opt-in gates controlled by the task strategy, and remember that `trellis-check` stays fixed outside this optional set. `trellis-improve-codebase-architecture` deep-review requires `trellis-code-architecture-review`; if deep-review is enabled without that prerequisite, stop and repair the task artifacts before continuing. If the marker is absent, treat it as a legacy task and preserve the old review-gate behavior instead of silently applying the new-task default. If the marker exists but the configured enabled/disabled lists are missing, stop and repair the task artifacts before continuing.

10. Understand the coding standards and patterns you need to follow, then proceed with your development plan.

This step is **mandatory** before writing any code.
