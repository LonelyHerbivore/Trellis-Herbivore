#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Multi-Platform Sub-Agent Context Injection Hook

Injects task-specific context when sub-agents (implement, check, review, research) are spawned.

Core Design Philosophy:
- Hook is responsible for injecting all context, subagent works autonomously with complete info
- Each agent has a dedicated jsonl file defining its context
- No resume needed, no segmentation, behavior controlled by code not prompt

Trigger: PreToolUse (before Task tool call)

Context Source: Trellis active task resolver points to task directory
- implement.jsonl - Implement agent dedicated context
- check.jsonl     - Check agent dedicated context
- prd.md          - Requirements document
- design.md       - Technical design for complex tasks
- implement.md    - Execution plan for complex tasks
- codex-review-output.txt - Code Review results
"""
from __future__ import annotations

# IMPORTANT: Suppress all warnings FIRST
import warnings
warnings.filterwarnings("ignore")

import json
import os
import sys
from pathlib import Path
from typing import Any

# IMPORTANT: Force stdout to use UTF-8 on Windows
# This fixes UnicodeEncodeError when outputting non-ASCII characters
if sys.platform.startswith("win"):
    import io as _io
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")  # type: ignore[union-attr]
    elif hasattr(sys.stdout, "detach"):
        sys.stdout = _io.TextIOWrapper(sys.stdout.detach(), encoding="utf-8", errors="replace")  # type: ignore[union-attr]


# =============================================================================
# Path Constants (change here to rename directories)
# =============================================================================

DIR_WORKFLOW = ".trellis"
DIR_SPEC = "spec"
FILE_TASK_JSON = "task.json"

# =============================================================================
# Subagent Constants (change here to rename subagent types)
# =============================================================================

AGENT_IMPLEMENT = "trellis-implement"
AGENT_CHECK = "trellis-check"
AGENT_RESEARCH = "trellis-research"
AGENT_SPEC_REVIEW = "trellis-spec-review"
AGENT_CODE_REVIEW = "trellis-code-review"
AGENT_CODE_ARCHITECTURE_REVIEW = "trellis-code-architecture-review"
AGENT_MERGE_REVIEW = "trellis-merge-review"

CLAUDE_SHARED_WORKTREE_MARKER = "/.trellis/trellis-worktrees/"

AGENTS_REVIEW = (
    AGENT_SPEC_REVIEW,
    AGENT_CODE_REVIEW,
    AGENT_CODE_ARCHITECTURE_REVIEW,
    AGENT_MERGE_REVIEW,
)
AGENTS_CHECK_CONTEXT = (AGENT_CHECK, *AGENTS_REVIEW)

# Agents that require a task directory
AGENTS_REQUIRE_TASK = (AGENT_IMPLEMENT, *AGENTS_CHECK_CONTEXT)
# All supported agents
AGENTS_ALL = (*AGENTS_REQUIRE_TASK, AGENT_RESEARCH)


def find_repo_root(start_path: str) -> str | None:
    """
    Find git repo root from start_path upwards

    Returns:
        Repo root path, or None if not found
    """
    current = Path(start_path).resolve()
    while current != current.parent:
        if (current / ".git").exists():
            return str(current)
        current = current.parent
    return None


def _candidate_scripts_dirs(repo_root: Path) -> list[Path]:
    candidates = [repo_root / DIR_WORKFLOW / "scripts"]
    try:
        if repo_root.parent.name == "trellis-worktrees" and repo_root.parent.parent.name == DIR_WORKFLOW:
            candidates.insert(0, repo_root.parent.parent.parent / DIR_WORKFLOW / "scripts")
    except Exception:
        pass
    return candidates


def _load_worktree_sync(repo_root: str):
    repo_path = Path(repo_root).resolve()
    for scripts_dir in _candidate_scripts_dirs(repo_path):
        if str(scripts_dir) not in sys.path:
            sys.path.insert(0, str(scripts_dir))
        try:
            from common import worktree_sync  # type: ignore[import-not-found]
            return worktree_sync
        except Exception:
            continue
    return None


def _infer_worktree_task(repo_root: str) -> str | None:
    worktree_sync = _load_worktree_sync(repo_root)
    if worktree_sync is None:
        return None
    try:
        return worktree_sync.infer_managed_worktree_task(Path(repo_root).resolve())
    except Exception:
        return None


def ensure_shared_worktree_bootstrap(repo_root: str, task_dir: str | None) -> None:
    if not task_dir:
        return

    worktree_sync = _load_worktree_sync(repo_root)
    if worktree_sync is None:
        return

    task_dir_name = Path(task_dir).name
    if not task_dir_name:
        return

    resolved = worktree_sync.resolve_shared_worktree_roots(
        Path(repo_root).resolve(),
        task_dir_name,
    )
    if not resolved:
        return

    main_root, worktree_root = resolved
    worktree_sync.sync_runtime_bundle(main_root, worktree_root)

    target_task_dir = worktree_sync.task_dir(worktree_root, task_dir_name)
    if not worktree_sync.has_any_task_artifact(target_task_dir):
        worktree_sync.sync_task_snapshot(main_root, worktree_root, task_dir_name)


def _detect_platform(input_data: dict) -> str | None:
    if isinstance(input_data.get("cursor_version"), str):
        return "cursor"
    env_map = {
        "CLAUDE_PROJECT_DIR": "claude",
        "CURSOR_PROJECT_DIR": "cursor",
        "CODEBUDDY_PROJECT_DIR": "codebuddy",
        "FACTORY_PROJECT_DIR": "droid",
        "GEMINI_PROJECT_DIR": "gemini",
        "QODER_PROJECT_DIR": "qoder",
        "KIRO_PROJECT_DIR": "kiro",
        "COPILOT_PROJECT_DIR": "copilot",
    }
    for env_name, platform in env_map.items():
        if os.environ.get(env_name):
            return platform
    script_parts = set(Path(sys.argv[0]).parts)
    if ".claude" in script_parts:
        return "claude"
    if ".cursor" in script_parts:
        return "cursor"
    if ".gemini" in script_parts:
        return "gemini"
    if ".qoder" in script_parts:
        return "qoder"
    if ".codebuddy" in script_parts:
        return "codebuddy"
    if ".factory" in script_parts:
        return "droid"
    if ".kiro" in script_parts:
        return "kiro"
    return None


def get_current_task(repo_root: str, input_data: dict) -> str | None:
    """Resolve current task directory through the unified active task resolver."""
    scripts_dir = Path(repo_root) / DIR_WORKFLOW / "scripts"
    if str(scripts_dir) not in sys.path:
        sys.path.insert(0, str(scripts_dir))
    try:
        from common.active_task import resolve_active_task  # type: ignore[import-not-found]
    except Exception:
        return _infer_worktree_task(repo_root)

    active = resolve_active_task(
        Path(repo_root),
        input_data,
        platform=_detect_platform(input_data),
    )
    return active.task_path or _infer_worktree_task(repo_root)


def read_file_content(base_path: str, file_path: str) -> str | None:
    """Read file content, return None if file doesn't exist"""
    full_path = os.path.join(base_path, file_path)
    if os.path.exists(full_path) and os.path.isfile(full_path):
        try:
            with open(full_path, "r", encoding="utf-8") as f:
                return f.read()
        except Exception:
            return None
    return None


def read_directory_contents(
    base_path: str, dir_path: str, max_files: int = 20
) -> list[tuple[str, str]]:
    """
    Read all .md files in a directory

    Args:
        base_path: Base path (usually repo_root)
        dir_path: Directory relative path
        max_files: Max files to read (prevent huge directories)

    Returns:
        [(file_path, content), ...]
    """
    full_path = os.path.join(base_path, dir_path)
    if not os.path.exists(full_path) or not os.path.isdir(full_path):
        return []

    results = []
    try:
        # Only read .md files, sorted by filename
        md_files = sorted(
            [
                f
                for f in os.listdir(full_path)
                if f.endswith(".md") and os.path.isfile(os.path.join(full_path, f))
            ]
        )

        for filename in md_files[:max_files]:
            file_full_path = os.path.join(full_path, filename)
            relative_path = os.path.join(dir_path, filename)
            try:
                with open(file_full_path, "r", encoding="utf-8") as f:
                    content = f.read()
                    results.append((relative_path, content))
            except Exception:
                continue
    except Exception:
        pass

    return results


def read_jsonl_entries(base_path: str, jsonl_path: str) -> list[tuple[str, str]]:
    """
    Read all file/directory contents referenced in jsonl file

    Schema:
        {"file": "path/to/file.md", "reason": "..."}
        {"file": "path/to/dir/", "type": "directory", "reason": "..."}
        {"_example": "..."}          # seed row — skipped (no `file` field)

    Rows without a ``file`` field (e.g. the self-describing seed line written
    by ``task.py create`` before the agent has curated entries) are skipped
    silently. If the resulting entry list is empty, a stderr warning is
    emitted so the operator can debug missing context.

    Returns:
        [(path, content), ...]
    """
    full_path = os.path.join(base_path, jsonl_path)
    if not os.path.exists(full_path):
        print(
            f"[inject-subagent-context] WARN: {jsonl_path} not found — "
            f"sub-agent will receive only task artifacts",
            file=sys.stderr,
        )
        return []

    results = []
    saw_real_entry = False
    try:
        with open(full_path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    item = json.loads(line)
                    file_path = item.get("file") or item.get("path")
                    entry_type = item.get("type", "file")

                    if not file_path:
                        # Seed / comment row — skip silently
                        continue

                    saw_real_entry = True
                    if entry_type == "directory":
                        # Read all .md files in directory
                        dir_contents = read_directory_contents(base_path, file_path)
                        results.extend(dir_contents)
                    else:
                        # Read single file
                        content = read_file_content(base_path, file_path)
                        if content:
                            results.append((file_path, content))
                except json.JSONDecodeError:
                    continue
    except Exception:
        pass

    if not saw_real_entry:
        print(
            f"[inject-subagent-context] WARN: {jsonl_path} has no curated "
            f"entries (only seed / empty) — sub-agent will receive only "
            f"task artifacts. See workflow.md planning artifact guidance.",
            file=sys.stderr,
        )

    return results




def get_agent_context(repo_root: str, task_dir: str, agent_type: str) -> str:
    """
    Get context from {agent_type}.jsonl for the specified agent.
    Only reads implement.jsonl or check.jsonl (the two JSONL files the task system creates).
    """
    context_parts = []

    agent_jsonl = f"{task_dir}/{agent_type}.jsonl"
    for file_path, content in read_jsonl_entries(repo_root, agent_jsonl):
        context_parts.append(f"=== {file_path} ===\n{content}")

    return "\n\n".join(context_parts)


def get_implement_context(repo_root: str, task_dir: str) -> str:
    """
    Complete context for Implement Agent

    Read order:
    1. All files in implement.jsonl (spec/research manifests)
    2. prd.md (requirements)
    3. design.md if present (technical design)
    4. implement.md if present (execution plan)
    """
    context_parts = []

    # 1. Read implement.jsonl
    base_context = get_agent_context(repo_root, task_dir, "implement")
    if base_context:
        context_parts.append(base_context)

    # 2. Requirements document
    prd_content = read_file_content(repo_root, f"{task_dir}/prd.md")
    if prd_content:
        context_parts.append(f"=== {task_dir}/prd.md (Requirements) ===\n{prd_content}")

    # 3. Technical design for complex tasks
    design_content = read_file_content(repo_root, f"{task_dir}/design.md")
    if design_content:
        context_parts.append(
            f"=== {task_dir}/design.md (Technical Design) ===\n{design_content}"
        )

    # 4. Execution plan for complex tasks
    implement_plan_content = read_file_content(repo_root, f"{task_dir}/implement.md")
    if implement_plan_content:
        context_parts.append(
            f"=== {task_dir}/implement.md (Execution Plan) ===\n{implement_plan_content}"
        )

    return "\n\n".join(context_parts)


def get_check_context(repo_root: str, task_dir: str) -> str:
    """
    Context for Check Agent: check.jsonl + task artifacts.
    """
    context_parts = []

    for file_path, content in read_jsonl_entries(repo_root, f"{task_dir}/check.jsonl"):
        context_parts.append(f"=== {file_path} ===\n{content}")

    prd_content = read_file_content(repo_root, f"{task_dir}/prd.md")
    if prd_content:
        context_parts.append(f"=== {task_dir}/prd.md (Requirements) ===\n{prd_content}")

    design_content = read_file_content(repo_root, f"{task_dir}/design.md")
    if design_content:
        context_parts.append(
            f"=== {task_dir}/design.md (Technical Design) ===\n{design_content}"
        )

    implement_plan_content = read_file_content(repo_root, f"{task_dir}/implement.md")
    if implement_plan_content:
        context_parts.append(
            f"=== {task_dir}/implement.md (Execution Plan) ===\n{implement_plan_content}"
        )

    return "\n\n".join(context_parts)


def get_finish_context(repo_root: str, task_dir: str) -> str:
    """
    Context for Finish phase: reuses check.jsonl + prd.md
    (Finish is a final check, same context source.)
    """
    return get_check_context(repo_root, task_dir)



def build_implement_prompt(original_prompt: str, context: str) -> str:
    """Build complete prompt for Implement"""
    return f"""<!-- trellis-hook-injected -->
# Implement Agent Task

You are the Implement Agent in the Multi-Agent Pipeline.

## Your Context

All the information you need has been prepared for you:

{context}

---

## Your Task

{original_prompt}

---

## Workflow

1. **Understand specs** - All dev specs are injected above, understand them
    2. **Understand task artifacts** - Read requirements, technical design if present, and execution plan if present
    3. **Implement feature** - Implement following specs and task artifacts
4. **Self-check** - Ensure code quality against check specs

## Important Constraints

- Do NOT execute git commit, only code modifications
- Follow all dev specs injected above
- Report list of modified/created files when done"""


def build_check_prompt(original_prompt: str, context: str) -> str:
    """Build complete prompt for Check"""
    return f"""<!-- trellis-hook-injected -->
# Check Agent Task

You are the Check Agent in the Multi-Agent Pipeline (code and cross-layer checker).

## Your Context

All check specs and dev specs you need:

{context}

---

## Your Task

{original_prompt}

---

## Workflow

1. **Get changes** - Run `git diff --name-only` and `git diff` to get code changes
2. **Check against specs** - Check item by item against specs above
3. **Self-fix** - Fix issues directly, don't just report
4. **Run verification** - Run project's lint and typecheck commands

## Important Constraints

- Fix issues yourself, don't just report
- Must execute complete checklist in check specs
- Pay special attention to impact radius analysis (L1-L5)"""


def build_finish_prompt(original_prompt: str, context: str) -> str:
    """Build complete prompt for Finish (final check before PR)"""
    return f"""<!-- trellis-hook-injected -->
# Finish Agent Task

You are performing the final check before creating a PR.

## Your Context

Finish checklist and requirements:

{context}

---

## Your Task

{original_prompt}

---

## Workflow

1. **Review changes** - Run `git diff --name-only` to see all changed files
	2. **Verify task artifacts** - Check requirements in prd.md and, when present, design.md / implement.md
3. **Spec sync** - Analyze whether changes introduce new patterns, contracts, or conventions
   - If new pattern/convention found: read target spec file → update it → update index.md if needed
   - If infra/cross-layer change: follow the 7-section mandatory template from update-spec.md
   - If pure code fix with no new patterns: skip this step
4. **Run final checks** - Execute lint and typecheck
5. **Confirm ready** - Ensure code is ready for PR

## Important Constraints

- You MAY update spec files when gaps are detected (use update-spec.md as guide)
- MUST read the target spec file BEFORE editing (avoid duplicating existing content)
- Do NOT update specs for trivial changes (typos, formatting, obvious fixes)
- If critical CODE issues found, report them clearly (fix specs, not code)
- Verify all acceptance criteria in prd.md are met
- Verify design.md and implement.md constraints when those files are present"""



def build_review_prompt(original_prompt: str, context: str) -> str:
    """Build complete prompt for read-only review gates."""
    return f"""<!-- trellis-hook-injected -->
# Review Gate Task

You are a read-only Trellis review gate.

## Your Context

All the requirements, design constraints, and review specs you need:

{context}

---

## Your Task

{original_prompt}

---

## Workflow

1. **Review changes** - Run `git diff --name-only` and `git diff` to inspect the change set
2. **Verify task artifacts** - Check `prd.md`, `design.md` when present, and `implement.md` when present
3. **Review against specs** - Check the relevant review criteria item by item
4. **Report gate result** - Return PASS / FAIL, blocking issues, and next actions

## Important Constraints

- Read-only gate: do NOT modify code directly
- Do NOT spawn another review, implement, or check sub-agent
- Verify all acceptance criteria in `prd.md`
- Verify design and execution-plan constraints when those files are present"""


def get_research_context(repo_root: str, task_dir: str | None) -> str:
    """
    Context for Research Agent — project structure overview for spec directories.

    `task_dir` kept for signature parity with get_implement_context / get_check_context
    so the dispatcher can call them uniformly.
    """
    _ = task_dir
    context_parts = []

    # 1. Project structure overview (dynamically discover spec directories)
    spec_path = f"{DIR_WORKFLOW}/{DIR_SPEC}"
    spec_root = Path(repo_root) / DIR_WORKFLOW / DIR_SPEC

    # Build spec tree dynamically
    tree_lines = [f"{spec_path}/"]
    if spec_root.is_dir():
        pkg_dirs = sorted(d for d in spec_root.iterdir() if d.is_dir())
        for i, pkg_dir in enumerate(pkg_dirs):
            is_last = i == len(pkg_dirs) - 1
            prefix = "└── " if is_last else "├── "
            layers = sorted(d.name for d in pkg_dir.iterdir() if d.is_dir())
            layer_info = f" ({', '.join(layers)})" if layers else ""
            tree_lines.append(f"{prefix}{pkg_dir.name}/{layer_info}")

    spec_tree = "\n".join(tree_lines)

    project_structure = f"""## Project Spec Directory Structure

```
{spec_tree}
```

To get structured package info, run: `python3 ./{DIR_WORKFLOW}/scripts/get_context.py --mode packages`

## Search Tips

- Spec files: `{spec_path}/**/*.md`
- Code search: Use Glob and Grep tools
- Tech solutions: Use mcp__exa__web_search_exa or mcp__exa__get_code_context_exa"""

    context_parts.append(project_structure)

    return "\n\n".join(context_parts)


def build_research_prompt(original_prompt: str, context: str) -> str:
    """Build complete prompt for Research"""
    return f"""# Research Agent Task

You are the Research Agent in the Multi-Agent Pipeline (search researcher).

## Core Principle

**You do one thing: find and explain information.**

You are a documenter, not a reviewer.

## Project Info

{context}

---

## Your Task

{original_prompt}

---

## Workflow

1. **Understand query** - Determine search type (internal/external) and scope
2. **Plan search** - List search steps for complex queries
3. **Execute search** - Execute multiple independent searches in parallel
4. **Organize results** - Output structured report

## Search Tools

| Tool | Purpose |
|------|---------|
| Glob | Search by filename pattern |
| Grep | Search by content |
| Read | Read file content |
| mcp__exa__web_search_exa | External web search |
| mcp__exa__get_code_context_exa | External code/doc search |

## Strict Boundaries

**Only allowed**: Describe what exists, where it is, how it works

**Forbidden** (unless explicitly asked):
- Suggest improvements
- Criticize implementation
- Recommend refactoring
- Modify any files

## Report Format

Provide structured search results including:
- List of files found (with paths)
- Code pattern analysis (if applicable)
- Related spec documents
- External references (if any)"""


def _string_value(value: Any) -> str:
    if isinstance(value, str):
        stripped = value.strip()
        return stripped
    return ""


def _extract_subagent_name(value: Any) -> str:
    """Extract a sub-agent name from common platform encodings.

    Cursor's native Task args encode custom sub-agents as a protobuf oneof,
    which can appear in hook JSON as either ``{"custom": {"name": "..."}}``
    or ``{"type": {"case": "custom", "value": {"name": "..."}}}``.
    """
    direct = _string_value(value)
    if direct:
        return direct

    if not isinstance(value, dict):
        return ""

    for key in ("name", "subagent_type_name", "subagentTypeName"):
        direct = _string_value(value.get(key))
        if direct:
            return direct

    custom = value.get("custom")
    if isinstance(custom, dict):
        custom_name = _string_value(custom.get("name"))
        if custom_name:
            return custom_name

    oneof = value.get("type")
    if isinstance(oneof, dict):
        case_name = _string_value(oneof.get("case"))
        if case_name == "custom":
            nested_value = oneof.get("value")
            if isinstance(nested_value, dict):
                custom_name = _string_value(nested_value.get("name"))
                if custom_name:
                    return custom_name
        if case_name:
            return case_name

    case_name = _string_value(value.get("case"))
    if case_name == "custom":
        nested_value = value.get("value")
        if isinstance(nested_value, dict):
            custom_name = _string_value(nested_value.get("name"))
            if custom_name:
                return custom_name
    if case_name:
        return case_name

    for agent_name in AGENTS_ALL:
        if agent_name in value:
            return agent_name

    return ""


def _extract_subagent_type(tool_input: dict) -> str:
    for key in (
        "subagent_type",
        "subagentType",
        "subagent_type_name",
        "subagentTypeName",
        "agent_type",
        "agentType",
        "name",
    ):
        agent_name = _extract_subagent_name(tool_input.get(key))
        if agent_name:
            return agent_name
    return ""


def _parse_hook_input(input_data: dict) -> tuple[str, str, dict]:
    """Parse hook input across different platform formats.

    Returns (subagent_type, original_prompt, tool_input).
    Handles:
    - Claude Code / Qoder / CodeBuddy / Droid: tool_name=Task|Agent, tool_input.subagent_type
    - Cursor: tool_name=Task|Subagent, tool_input.subagent_type
    - Copilot CLI: toolName=task (camelCase key, lowercase value)
    - Gemini CLI: tool_name IS the agent name (BeforeTool matcher already filtered)
    - Kiro: agentSpawn hook, agent_name field at top level
    """
    tool_input = input_data.get("tool_input", {})

    # Standard format: Task/Agent tool with subagent_type
    tool_name = input_data.get("tool_name", "") or input_data.get("toolName", "")
    if tool_name.lower() in ("task", "agent", "subagent"):
        return (
            _extract_subagent_type(tool_input),
            tool_input.get("prompt", ""),
            tool_input,
        )

    # Kiro: agentSpawn hook passes agent_name at top level
    agent_name = input_data.get("agent_name", "")
    if agent_name:
        return agent_name, tool_input.get("prompt", input_data.get("prompt", "")), tool_input

    # Gemini CLI: BeforeTool where tool_name IS the agent name
    # (matcher already ensured it's one of our agents)
    if tool_name in AGENTS_ALL:
        return tool_name, tool_input.get("prompt", ""), tool_input

    # Copilot CLI: toolName field (camelCase), value might be the agent name
    tool_name_camel = input_data.get("toolName", "")
    if tool_name_camel in AGENTS_ALL:
        return tool_name_camel, input_data.get("toolArgs", ""), tool_input

    return "", "", tool_input


def _read_trellis_switch_enabled() -> bool:
    try:
        cwd = Path.cwd()
        while cwd != cwd.parent:
            trellis_dir = cwd / ".trellis"
            if trellis_dir.is_dir():
                dev_file = trellis_dir / ".developer"
                if dev_file.is_file():
                    for line in dev_file.read_text(encoding="utf-8").splitlines():
                        if line.startswith("name="):
                            name = line.split("=", 1)[1].strip()
                            switch = trellis_dir / "workspace" / name / "trellis-switch.json"
                            if switch.is_file():
                                return json.loads(switch.read_text(encoding="utf-8")).get("enabled", True)
                return True
            cwd = cwd.parent
    except Exception:
        pass
    return True


def _normalize_hook_text(value: Any) -> str:
    if isinstance(value, str):
        return value.replace("\\", "/").lower()
    try:
        return json.dumps(value, ensure_ascii=False).replace("\\", "/").lower()
    except Exception:
        return ""


def is_claude_code_dev_agent(subagent_type: str) -> bool:
    return subagent_type in (AGENT_IMPLEMENT, *AGENTS_CHECK_CONTEXT)


def _extract_strategy_field(text: str, *labels: str) -> str | None:
    for raw_line in text.splitlines():
        line = raw_line.strip()
        if line.startswith(("-", "*")):
            line = line[1:].strip()
        lowered = line.lower()
        for label in labels:
            normalized_label = label.lower()
            if lowered.startswith(normalized_label):
                return line[len(label):].strip()
    return None


def _extract_strategy_block_choice(text: str, block_key: str) -> str | None:
    current_block: str | None = None
    for raw_line in text.splitlines():
        line = raw_line.strip()
        lowered = line.lower()
        if lowered.startswith("###"):
            if "a." in lowered and ("开发模式" in line or "development mode" in lowered):
                current_block = "mode"
            elif "b." in lowered and ("分支" in line or "branch" in lowered or "worktree" in lowered):
                current_block = "branch"
            else:
                current_block = None
            continue
        if current_block != block_key:
            continue
        if line.startswith(("-", "*")):
            line = line[1:].strip()
            lowered = line.lower()
        choice = _extract_strategy_field(line, "选择：", "choice:")
        if choice is not None:
            return choice
    return None


def _parse_shared_worktree_strategy(text: str | None) -> bool | None:
    if not text:
        return None
    development_mode = _extract_strategy_field(text, "开发模式：", "development mode:")
    branch_strategy = _extract_strategy_field(text, "分支策略：", "branch strategy:")
    if development_mode is None and branch_strategy is None:
        development_mode = _extract_strategy_block_choice(text, "mode")
        branch_strategy = _extract_strategy_block_choice(text, "branch")
    if development_mode is None and branch_strategy is None:
        return None
    return "subagent" in _normalize_hook_text(development_mode) and "worktree" in _normalize_hook_text(branch_strategy)


def _task_strategy_uses_shared_worktree(repo_root: str, task_dir: str | None) -> bool:
    if not task_dir:
        return False
    implement_plan = read_file_content(repo_root, f"{task_dir}/implement.md")
    implement_strategy = _parse_shared_worktree_strategy(implement_plan)
    if implement_strategy is not None:
        return implement_strategy
    prd = read_file_content(repo_root, f"{task_dir}/prd.md")
    prd_strategy = _parse_shared_worktree_strategy(prd)
    return bool(prd_strategy)


def _path_uses_shared_worktree(path_value: Any) -> bool:
    return CLAUDE_SHARED_WORKTREE_MARKER in _normalize_hook_text(path_value)


def _looks_like_path_key(key: str | None) -> bool:
    if not key:
        return False
    lowered = key.lower()
    if lowered in {
        "cwd",
        "path",
        "paths",
        "file",
        "files",
        "file_path",
        "filepath",
        "dir",
        "directory",
        "target",
        "targets",
        "target_path",
        "worktree",
        "worktree_path",
        "repo_root",
        "workspace_root",
        "root",
    }:
        return True
    return lowered.endswith(("_path", "_paths", "_file", "_files", "_dir", "_root"))


def _extract_shared_worktree_task_name(path_value: Any) -> str | None:
    normalized = _normalize_hook_text(path_value)
    if CLAUDE_SHARED_WORKTREE_MARKER not in normalized:
        return None
    suffix = normalized.split(CLAUDE_SHARED_WORKTREE_MARKER, 1)[1]
    task_name = suffix.split("/", 1)[0].strip()
    return task_name or None


def _tool_input_targets_shared_worktree(value: Any, key: str | None = None) -> bool:
    if isinstance(value, dict):
        for nested_key, nested_value in value.items():
            if _tool_input_targets_shared_worktree(nested_value, str(nested_key)):
                return True
        return False
    if isinstance(value, list):
        for item in value:
            if _tool_input_targets_shared_worktree(item, key):
                return True
        return False
    if not _looks_like_path_key(key):
        return False
    return _path_uses_shared_worktree(value)


def _tool_input_shared_worktree_task(value: Any, key: str | None = None) -> str | None:
    if isinstance(value, dict):
        for nested_key, nested_value in value.items():
            task_name = _tool_input_shared_worktree_task(nested_value, str(nested_key))
            if task_name:
                return task_name
        return None
    if isinstance(value, list):
        for item in value:
            task_name = _tool_input_shared_worktree_task(item, key)
            if task_name:
                return task_name
        return None
    if not _looks_like_path_key(key):
        return None
    return _extract_shared_worktree_task_name(value)


def infer_task_dir_from_shared_worktree_signal(
    repo_root: str,
    tool_input: dict,
    cwd: str,
) -> str | None:
    for path_value in (cwd, repo_root):
        task_name = _extract_shared_worktree_task_name(path_value)
        if task_name:
            return f".trellis/tasks/{task_name}"

    task_name = _tool_input_shared_worktree_task(tool_input)
    if task_name:
        return f".trellis/tasks/{task_name}"
    return None


def has_shared_worktree_signal(
    repo_root: str,
    task_dir: str | None,
    tool_input: dict,
    cwd: str,
) -> bool:
    if _task_strategy_uses_shared_worktree(repo_root, task_dir):
        return True
    if _path_uses_shared_worktree(repo_root) or _path_uses_shared_worktree(cwd):
        return True
    return _tool_input_targets_shared_worktree(tool_input)


def strip_conflicting_worktree_isolation(tool_input: dict) -> tuple[dict, bool]:
    isolation = tool_input.get("isolation")
    if isinstance(isolation, str) and isolation.strip().lower() == "worktree":
        updated = dict(tool_input)
        updated.pop("isolation", None)
        return updated, True
    return tool_input, False


def _build_shared_worktree_conflict_notice(task_dir: str | None) -> str:
    task_name = Path(task_dir).name if task_dir else "<task-dir-name>"
    return (
        "<trellis-worktree-conflict>\n"
        "检测到 Claude Code 共享 worktree 策略与宿主 `isolation: \"worktree\"` 冲突。\n"
        "Trellis 已在子代理派发前自动移除 `isolation: \"worktree\"`。\n"
        f"当前子代理将继续在共享 `./.trellis/trellis-worktrees/{task_name}` 路径工作。\n"
        "</trellis-worktree-conflict>"
    )


def _build_shared_worktree_conflict_system_message(task_dir: str | None) -> str:
    task_name = Path(task_dir).name if task_dir else "<task-dir-name>"
    return (
        "Trellis 已自动移除冲突的 `isolation: \"worktree\"`，"
        f"当前子代理继续使用共享 `./.trellis/trellis-worktrees/{task_name}` 路径。"
    )


def main():
    if os.environ.get("TRELLIS_HOOKS") == "0" or os.environ.get("TRELLIS_DISABLE_HOOKS") == "1":
        sys.exit(0)

    try:
        input_data = json.load(sys.stdin)
    except json.JSONDecodeError:
        sys.exit(0)

    platform = _detect_platform(input_data)
    if platform == "claude" and not _read_trellis_switch_enabled():
        sys.exit(0)

    subagent_type, original_prompt, tool_input = _parse_hook_input(input_data)
    cwd = input_data.get("cwd", os.getcwd())

    # Only handle subagent types we care about
    if subagent_type not in AGENTS_ALL:
        sys.exit(0)

    # Find repo root
    repo_root = find_repo_root(cwd)
    if not repo_root:
        sys.exit(0)

    # Get current task directory (research doesn't require it)
    task_dir = get_current_task(repo_root, input_data)
    if not task_dir and is_claude_code_dev_agent(subagent_type):
        task_dir = infer_task_dir_from_shared_worktree_signal(repo_root, tool_input, cwd)

    # implement/check/review need task directory
    if subagent_type in AGENTS_REQUIRE_TASK:
        if not task_dir:
            sys.exit(0)
        # Check if task directory exists
        task_dir_full = os.path.join(repo_root, task_dir)
        if not os.path.exists(task_dir_full):
            sys.exit(0)

    hook_notice = ""
    hook_system_message = ""
    normalized_tool_input = tool_input
    shared_worktree_signal = False

    if platform == "claude" and is_claude_code_dev_agent(subagent_type):
        shared_worktree_signal = has_shared_worktree_signal(
            repo_root,
            task_dir,
            tool_input,
            cwd,
        )
        if shared_worktree_signal:
            ensure_shared_worktree_bootstrap(repo_root, task_dir)
            normalized_tool_input, stripped = strip_conflicting_worktree_isolation(tool_input)
            if stripped:
                hook_notice = _build_shared_worktree_conflict_notice(task_dir)
                hook_system_message = _build_shared_worktree_conflict_system_message(task_dir)

    # Check for [finish] marker in prompt (check agent with finish context)
    is_finish_phase = "[finish]" in original_prompt.lower()

    # Get context and build prompt based on subagent type
    if subagent_type == AGENT_IMPLEMENT:
        assert task_dir is not None  # validated above
        context = get_implement_context(repo_root, task_dir)
        new_prompt = build_implement_prompt(original_prompt, context)
    elif subagent_type == AGENT_CHECK:
        assert task_dir is not None  # validated above
        if is_finish_phase:
            # Finish phase: use finish context (lighter, focused on final verification)
            context = get_finish_context(repo_root, task_dir)
            new_prompt = build_finish_prompt(original_prompt, context)
        else:
            # Regular check phase: use check context (full specs for self-fix loop)
            context = get_check_context(repo_root, task_dir)
            new_prompt = build_check_prompt(original_prompt, context)
    elif subagent_type in AGENTS_REVIEW:
        assert task_dir is not None  # validated above
        context = get_check_context(repo_root, task_dir)
        new_prompt = build_review_prompt(original_prompt, context)
    elif subagent_type == AGENT_RESEARCH:
        # Research can work without task directory
        context = get_research_context(repo_root, task_dir)
        new_prompt = build_research_prompt(original_prompt, context)
    else:
        sys.exit(0)

    if not context:
        sys.exit(0)

    # Return updated input — use a multi-format output that covers all platforms.
    # Most platforms ignore unrecognized fields, so we include multiple formats.
    # The platform picks whichever fields it understands.
    updated = {**normalized_tool_input, "prompt": new_prompt}
    hook_specific_output: dict[str, Any] = {
        "hookEventName": "PreToolUse",
        "permissionDecision": "allow",
        "updatedInput": updated,
    }
    if hook_notice:
        hook_specific_output["additionalContext"] = hook_notice

    output = {
        # Claude Code / Qoder / CodeBuddy / Droid format
        "hookSpecificOutput": hook_specific_output,
        # Cursor format
        "permission": "allow",
        "updated_input": updated,
        # Gemini format
        "updatedInput": updated,
    }
    if hook_system_message:
        output["systemMessage"] = hook_system_message

    print(json.dumps(output, ensure_ascii=False))
    sys.exit(0)


if __name__ == "__main__":
    main()
