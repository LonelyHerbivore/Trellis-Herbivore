"""Structured workflow-state contract for task.json files.

The TypeScript Core schema owns the public SDK contract. This module mirrors
the same JSON validation for generated Python task scripts so Claude Code and
Codex observe identical task recovery semantics.
"""

from __future__ import annotations

import re


WORKFLOW_REVIEW_GATES: tuple[str, ...] = (
    "spec-review",
    "code-review",
    "code-architecture-review",
    "merge-review",
)

_WORKFLOW_HOSTS = ("claude", "codex")
_EXECUTION_MODES = ("main-session", "subagent")
_WORKTREE_MODES = ("current-checkout", "new-worktree", "existing-worktree")
_DEVELOPMENT_FLOWS = ("default", "tdd")
_GATE_STATUSES = ("pending", "PASS", "FAIL", "skipped")

_TASK_REQUIRED_FIELDS = (
    "id",
    "name",
    "title",
    "description",
    "status",
    "dev_type",
    "scope",
    "package",
    "priority",
    "creator",
    "assignee",
    "createdAt",
    "completedAt",
    "branch",
    "base_branch",
    "worktree_path",
    "commit",
    "pr_url",
    "subtasks",
    "children",
    "parent",
    "relatedFiles",
    "notes",
    "meta",
)
_TASK_STRING_FIELDS = (
    "id",
    "name",
    "title",
    "description",
    "status",
    "priority",
    "creator",
    "assignee",
    "createdAt",
    "notes",
)
_TASK_NULLABLE_STRING_FIELDS = (
    "dev_type",
    "scope",
    "package",
    "completedAt",
    "branch",
    "base_branch",
    "worktree_path",
    "commit",
    "pr_url",
    "parent",
)
_TASK_STRING_ARRAY_FIELDS = ("subtasks", "children", "relatedFiles")


def new_unselected_workflow() -> dict[str, str]:
    """Return the explicit pre-selection state written for new tasks."""
    return {"selection_status": "unselected"}


def validate_task_record(task_data: object) -> list[str]:
    """Return task-record violations; a complete record without workflow is legacy."""
    if not isinstance(task_data, dict):
        return ["task record must be a JSON object"]
    errors = _validate_legacy_fields(task_data)
    if errors:
        return errors
    if "workflow" not in task_data:
        return []
    return _validate_workflow(task_data["workflow"], task_data.get("worktree_path"))


def _validate_legacy_fields(task_data: dict) -> list[str]:
    for field in _TASK_REQUIRED_FIELDS:
        if field not in task_data:
            return [f"task.{field} is required"]

    errors: list[str] = []
    for field in _TASK_STRING_FIELDS:
        if not isinstance(task_data[field], str):
            errors.append(f"task.{field} must be a string")
    for field in _TASK_NULLABLE_STRING_FIELDS:
        value = task_data[field]
        if value is not None and not isinstance(value, str):
            errors.append(f"task.{field} must be a string or null")
    for field in _TASK_STRING_ARRAY_FIELDS:
        value = task_data[field]
        if not isinstance(value, list) or any(not isinstance(item, str) for item in value):
            errors.append(f"task.{field} must be an array of strings")
    if not isinstance(task_data["meta"], dict):
        errors.append("task.meta must be a JSON object")
    return errors


def _validate_workflow(workflow: object, worktree_path: object) -> list[str]:
    field = "task.workflow"
    if not isinstance(workflow, dict):
        return [f"{field} must be a JSON object"]

    if "selection_status" in workflow:
        exact_error = _validate_exact_keys(workflow, ("selection_status",), field)
        if exact_error:
            return [exact_error]
        if workflow["selection_status"] != "unselected":
            return [f"{field}.selection_status must be unselected"]
        return []

    expected = (
        "contract",
        "host",
        "execution_mode",
        "worktree_mode",
        "development_flow",
        "review_gates",
    )
    exact_error = _validate_exact_keys(workflow, expected, field)
    if exact_error:
        return [exact_error]
    if workflow["contract"] != "explicit-selection-v1":
        return [f"{field}.contract must be explicit-selection-v1"]

    errors: list[str] = []
    errors.extend(_validate_enum(workflow["host"], _WORKFLOW_HOSTS, f"{field}.host"))
    errors.extend(
        _validate_enum(
            workflow["execution_mode"],
            _EXECUTION_MODES,
            f"{field}.execution_mode",
        )
    )
    errors.extend(
        _validate_enum(
            workflow["worktree_mode"],
            _WORKTREE_MODES,
            f"{field}.worktree_mode",
        )
    )
    errors.extend(
        _validate_enum(
            workflow["development_flow"],
            _DEVELOPMENT_FLOWS,
            f"{field}.development_flow",
        )
    )
    if not isinstance(worktree_path, str) or not worktree_path.strip():
        errors.append(
            f"{field}.worktree_mode requires task.worktree_path to be a non-empty string"
        )

    errors.extend(_validate_review_gates(workflow["review_gates"]))
    return errors


def _validate_review_gates(value: object) -> list[str]:
    field = "task.workflow.review_gates"
    if not isinstance(value, dict):
        return [f"{field} must be a JSON object"]
    exact_error = _validate_exact_keys(value, ("enabled", "disabled", "runs"), field)
    if exact_error:
        return [exact_error]

    enabled, enabled_errors = _validate_gate_list(value["enabled"], f"{field}.enabled")
    disabled, disabled_errors = _validate_gate_list(value["disabled"], f"{field}.disabled")
    errors = [*enabled_errors, *disabled_errors]
    if errors:
        return errors

    selected = [*enabled, *disabled]
    if len(selected) != len(WORKFLOW_REVIEW_GATES) or set(selected) != set(WORKFLOW_REVIEW_GATES):
        return [
            f"{field}.enabled and {field}.disabled must partition every workflow review gate exactly once"
        ]

    runs = value["runs"]
    if not isinstance(runs, dict):
        return [f"{field}.runs must be a JSON object"]
    if set(runs) != set(enabled):
        return [f"{field}.runs must contain exactly the enabled review gates"]

    for gate in enabled:
        errors.extend(_validate_gate_run(runs[gate], f"{field}.runs.{gate}"))
    return errors


def _validate_gate_list(value: object, field: str) -> tuple[list[str], list[str]]:
    if not isinstance(value, list) or any(not isinstance(gate, str) for gate in value):
        return [], [f"{field} must be an array of workflow review gates"]

    errors: list[str] = []
    for gate in value:
        if gate not in WORKFLOW_REVIEW_GATES:
            errors.append(f"{field} contains an unknown workflow review gate: {gate}")
        elif value.count(gate) > 1:
            errors.append(f"{field} must not contain duplicate workflow review gates")
            break
    return value, errors


def _validate_gate_run(value: object, field: str) -> list[str]:
    if not isinstance(value, dict):
        return [f"{field} must be a JSON object"]
    exact_error = _validate_exact_keys(value, ("status", "attempts", "report_path"), field)
    if exact_error:
        return [exact_error]

    errors = _validate_enum(value["status"], _GATE_STATUSES, f"{field}.status")
    attempts = value["attempts"]
    if isinstance(attempts, bool) or not isinstance(attempts, int) or attempts < 0:
        errors.append(f"{field}.attempts must be a non-negative integer")
    report_path = value["report_path"]
    if report_path is not None and (
        not isinstance(report_path, str) or not _is_task_relative_report_path(report_path)
    ):
        errors.append(f"{field}.report_path must be a task-relative path or null")
    return errors


def _validate_enum(value: object, allowed: tuple[str, ...], field: str) -> list[str]:
    if not isinstance(value, str) or value not in allowed:
        return [f"{field} must be one of: {', '.join(allowed)}"]
    return []


def _validate_exact_keys(data: dict, expected: tuple[str, ...], field: str) -> str | None:
    if len(data) != len(expected) or set(data) != set(expected):
        return f"{field} must contain exactly: {', '.join(expected)}"
    return None


def _is_task_relative_report_path(value: str) -> bool:
    if (
        not value.strip()
        or re.match(r"^[A-Za-z]:", value)
        or value.startswith("/")
        or value.startswith("\\")
    ):
        return False
    return all(part not in ("", ".", "..") for part in re.split(r"[\\/]", value))
