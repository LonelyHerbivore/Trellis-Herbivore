from __future__ import annotations

import hashlib
import os
import re
import shutil
from dataclasses import dataclass
from pathlib import Path

from common.git import run_git
from common.io import read_json
from common.paths import DIR_TASKS, FILE_TASK_JSON, get_tasks_dir

DIR_WORKFLOW = ".trellis"
WORKTREE_PARENT_DIR = ".trellis"
WORKTREE_ROOT_DIR = "trellis-worktrees"
RUNTIME_BUNDLE_FILES = (
    ".trellis/workflow.md",
    ".trellis/config.yaml",
    ".trellis/.gitignore",
)
RUNTIME_BUNDLE_DIRS = (
    ".trellis/scripts",
)
PLANNING_FILE_NAMES = (
    "task.json",
    "prd.md",
    "design.md",
    "implement.md",
    "implement.jsonl",
    "check.jsonl",
)
PLANNING_DIR_NAMES = ("research",)


class TaskWorktreeError(RuntimeError):
    """Raised when a task worktree cannot be resolved or changed safely."""


@dataclass(frozen=True)
class WorktreeEntry:
    root: Path
    branch: str | None


@dataclass(frozen=True)
class TaskWorktree:
    root: Path
    branch: str
    base_branch: str
    mode: str
    created: bool = False
    created_branch: bool = False


def _remove_path(path: Path) -> None:
    if path.is_symlink() or path.is_file():
        path.unlink()
        return
    if path.is_dir():
        shutil.rmtree(path)


def _hash_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(65536), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _snapshot_dir(path: Path) -> dict[str, str]:
    if not path.is_dir():
        return {}
    snapshot: dict[str, str] = {}
    for child in sorted(path.rglob("*")):
        if child.is_file():
            snapshot[child.relative_to(path).as_posix()] = _hash_file(child)
    return snapshot


def _same_file(src: Path, dst: Path) -> bool:
    return src.is_file() and dst.is_file() and _hash_file(src) == _hash_file(dst)


def _same_tree(src: Path, dst: Path) -> bool:
    return src.is_dir() and dst.is_dir() and _snapshot_dir(src) == _snapshot_dir(dst)


def _copy_file(src: Path, dst: Path) -> None:
    dst.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(src, dst)


def _copy_tree(src: Path, dst: Path) -> None:
    if dst.exists():
        _remove_path(dst)
    dst.parent.mkdir(parents=True, exist_ok=True)
    shutil.copytree(src, dst)


def _copy_file_if_missing(src: Path, dst: Path) -> bool:
    """Copy a generated file only when the target does not already exist."""
    if dst.exists() or dst.is_symlink():
        return False
    _copy_file(src, dst)
    return True


def _copy_tree_if_missing(src: Path, dst: Path) -> bool:
    """Merge generated files without replacing local runtime customizations."""
    if dst.is_symlink() or dst.is_file():
        return False
    dst.mkdir(parents=True, exist_ok=True)
    copied = False
    for child in sorted(src.iterdir()):
        target = dst / child.name
        if child.is_dir():
            copied = _copy_tree_if_missing(child, target) or copied
        elif child.is_file():
            copied = _copy_file_if_missing(child, target) or copied
    return copied


def task_dir(repo_root: Path, task_dir_name: str) -> Path:
    return repo_root / DIR_WORKFLOW / DIR_TASKS / task_dir_name


def _canonical_path(path: Path) -> Path:
    return path.expanduser().resolve()


def _path_key(path: Path) -> str:
    return os.path.normcase(os.path.normpath(str(_canonical_path(path))))


def _same_path(left: Path, right: Path) -> bool:
    return _path_key(left) == _path_key(right)


def _normalize_shell_path(value: str) -> str:
    """Normalize Git Bash, Cygwin, and WSL drive paths on Windows."""
    if os.name != "nt":
        return value
    path_value = value.strip()
    for pattern in (r"^/([A-Za-z])/(.*)", r"^/cygdrive/([A-Za-z])/(.*)", r"^/mnt/([A-Za-z])/(.*)"):
        match = re.match(pattern, path_value)
        if match:
            drive, rest = match.groups()
            return drive.upper() + ":\\\\" + rest.replace("/", "\\\\")
    return value


def _path_from_value(value: str, repo_root: Path) -> Path:
    candidate = Path(_normalize_shell_path(value)).expanduser()
    if not candidate.is_absolute():
        candidate = repo_root / candidate
    return _canonical_path(candidate)


def _git_common_dir(repo_root: Path) -> Path:
    code, stdout, stderr = run_git(["rev-parse", "--git-common-dir"], cwd=repo_root)
    if code != 0 or not stdout.strip():
        raise TaskWorktreeError(
            f"'{repo_root}' is not a Git checkout: {stderr.strip() or 'git rev-parse failed'}"
        )
    raw = Path(stdout.strip())
    if not raw.is_absolute():
        raw = repo_root / raw
    return _canonical_path(raw)


def _git_dir(repo_root: Path) -> Path:
    code, stdout, stderr = run_git(["rev-parse", "--git-dir"], cwd=repo_root)
    if code != 0 or not stdout.strip():
        raise TaskWorktreeError(
            f"'{repo_root}' is not a Git checkout: {stderr.strip() or 'git rev-parse failed'}"
        )
    raw = Path(stdout.strip())
    if not raw.is_absolute():
        raw = repo_root / raw
    return _canonical_path(raw)


def _is_linked_worktree(repo_root: Path) -> bool:
    try:
        return not _same_path(_git_common_dir(repo_root), _git_dir(repo_root))
    except TaskWorktreeError:
        return False


def _parse_worktree_list(stdout: str) -> list[WorktreeEntry]:
    entries: list[WorktreeEntry] = []
    current: dict[str, str] = {}

    def append_current() -> None:
        worktree = current.get("worktree")
        if not worktree:
            return
        branch = current.get("branch")
        if branch and branch.startswith("refs/heads/"):
            branch = branch[len("refs/heads/"):]
        entries.append(WorktreeEntry(root=_canonical_path(Path(worktree)), branch=branch))

    for raw_line in [*stdout.splitlines(), ""]:
        if not raw_line:
            append_current()
            current = {}
            continue
        key, _, value = raw_line.partition(" ")
        if key and value:
            current[key] = value
    return entries


def list_registered_worktrees(repo_root: Path) -> list[WorktreeEntry]:
    code, stdout, stderr = run_git(["worktree", "list", "--porcelain"], cwd=repo_root)
    if code != 0:
        raise TaskWorktreeError(
            f"Unable to list Git worktrees: {stderr.strip() or 'git worktree list failed'}"
        )
    entries = _parse_worktree_list(stdout)
    if not entries:
        raise TaskWorktreeError("Git returned no registered worktrees")
    return entries


def primary_worktree_root(repo_root: Path) -> Path:
    return list_registered_worktrees(repo_root)[0].root


def _registered_worktree(repo_root: Path, candidate: Path) -> WorktreeEntry:
    candidate = _canonical_path(candidate)
    if not candidate.is_dir():
        raise TaskWorktreeError(f"Worktree path does not exist: {candidate}")

    common_dir = _git_common_dir(repo_root)
    try:
        candidate_common_dir = _git_common_dir(candidate)
    except TaskWorktreeError as exc:
        raise TaskWorktreeError(
            f"Worktree path is not a Git checkout: {candidate}"
        ) from exc
    if not _same_path(common_dir, candidate_common_dir):
        raise TaskWorktreeError(
            f"Worktree path belongs to another Git repository: {candidate}"
        )

    for entry in list_registered_worktrees(repo_root):
        if _same_path(entry.root, candidate):
            return entry
    raise TaskWorktreeError(
        f"Worktree path is not registered by Git: {candidate}. "
        "Use 'git worktree add' or choose a registered worktree."
    )


def _current_branch(repo_root: Path) -> str:
    code, stdout, stderr = run_git(["branch", "--show-current"], cwd=repo_root)
    branch = stdout.strip()
    if code != 0 or not branch:
        raise TaskWorktreeError(
            f"Worktree must be on a named branch: {repo_root}. "
            f"{stderr.strip() or 'Detached HEAD is not supported.'}"
        )
    return branch


def _verify_revision(repo_root: Path, revision: str, label: str) -> None:
    if not isinstance(revision, str) or not revision.strip():
        raise TaskWorktreeError(f"Task {label} is required")
    code, _, _ = run_git(
        ["rev-parse", "--verify", "--quiet", f"{revision}^{{commit}}"],
        cwd=repo_root,
    )
    if code != 0:
        raise TaskWorktreeError(
            f"Task {label} does not resolve to a commit in this repository: {revision}"
        )


def _local_branch_exists(repo_root: Path, branch: str) -> bool:
    code, _, _ = run_git(
        ["show-ref", "--verify", "--quiet", f"refs/heads/{branch}"],
        cwd=repo_root,
    )
    return code == 0


def _task_worktree_mode(task_data: dict) -> str:
    if "workflow" in task_data:
        workflow = task_data["workflow"]
        if not isinstance(workflow, dict):
            raise TaskWorktreeError("Task workflow must be a JSON object")
        if workflow.get("selection_status") == "unselected":
            raise TaskWorktreeError(
                "Task workflow selection is incomplete; select a worktree mode before claiming one."
            )
        mode = workflow.get("worktree_mode")
        if mode in ("current-checkout", "new-worktree", "existing-worktree"):
            return mode
        if "worktree_mode" in workflow:
            raise TaskWorktreeError(f"Unsupported task worktree mode: {mode!r}")
        raise TaskWorktreeError(
            "Task workflow has no selected worktree mode. Complete the structured workflow selection first."
        )

    if isinstance(task_data.get("worktree_path"), str) and task_data["worktree_path"].strip():
        # Legacy task records did not have workflow.worktree_mode. A recorded
        # path remains an existing-worktree claim instead of being migrated.
        return "existing-worktree"
    raise TaskWorktreeError(
        "Task has no selected worktree mode. Complete the structured workflow selection first."
    )


def _read_task_record_file(task_json: Path) -> dict:
    """Read one task record and fail closed when an existing file is invalid."""
    if not task_json.exists():
        raise FileNotFoundError(task_json)
    data = read_json(task_json)
    if not isinstance(data, dict):
        raise TaskWorktreeError(f"Task record is invalid or unreadable: {task_json}")
    return data


def _load_task_record(
    repo_root: Path,
    task_dir_name: str,
) -> tuple[Path, Path, dict] | None:
    repo_root = _canonical_path(repo_root)
    try:
        primary = primary_worktree_root(repo_root)
    except TaskWorktreeError:
        primary = repo_root
    candidate_roots = [primary] if not _same_path(primary, repo_root) else [repo_root]

    for candidate_root in candidate_roots:
        task_json = task_dir(candidate_root, task_dir_name) / FILE_TASK_JSON
        if not task_json.exists():
            continue
        data = _read_task_record_file(task_json)
        return candidate_root, task_json, data
    return None


def load_task_record(
    repo_root: Path,
    task_dir_name: str,
) -> tuple[Path, Path, dict] | None:
    """Load the task record using the primary checkout as the preferred source."""
    return _load_task_record(repo_root, task_dir_name)


def _task_record_context(
    repo_root: Path,
    task_dir_name: str,
    task_data: dict,
) -> tuple[Path, dict]:
    """Use the primary checkout as the anchor for linked task records."""
    repo_root = _canonical_path(repo_root)
    try:
        primary = primary_worktree_root(repo_root)
    except TaskWorktreeError:
        primary = repo_root
    if not _same_path(primary, repo_root):
        primary_task_json = task_dir(primary, task_dir_name) / FILE_TASK_JSON
        if not primary_task_json.exists():
            raise TaskWorktreeError(
                f"Primary task record not found for linked checkout: {primary_task_json}"
            )
        return primary, _read_task_record_file(primary_task_json)
    return repo_root, task_data


def _active_task_path_conflict(
    repo_root: Path,
    task_dir_name: str,
    candidate: Path,
) -> str | None:
    try:
        scan_root = primary_worktree_root(repo_root)
    except TaskWorktreeError:
        scan_root = repo_root
    tasks_dir = get_tasks_dir(scan_root)
    if not tasks_dir.is_dir():
        return None

    candidate_key = _path_key(candidate)
    for other_task_dir in sorted(tasks_dir.iterdir()):
        if (
            not other_task_dir.is_dir()
            or other_task_dir.name in ("archive", task_dir_name)
        ):
            continue
        data = read_json(other_task_dir / FILE_TASK_JSON)
        if not isinstance(data, dict) or data.get("status") in ("completed", "done"):
            continue
        path_value = data.get("worktree_path")
        if not isinstance(path_value, str) or not path_value.strip():
            continue
        try:
            other_path = _path_from_value(path_value, scan_root)
        except OSError:
            continue
        if _path_key(other_path) == candidate_key:
            return other_task_dir.name
    return None


def _assert_task_path_unclaimed(
    repo_root: Path,
    task_dir_name: str,
    candidate: Path,
) -> None:
    conflict = _active_task_path_conflict(repo_root, task_dir_name, candidate)
    if conflict:
        raise TaskWorktreeError(
            f"Worktree path is already claimed by active task '{conflict}': {candidate}"
        )


def _task_base_branch(
    repo_root: Path,
    task_data: dict,
    requested_base_branch: str | None,
) -> str:
    base_branch = requested_base_branch or task_data.get("base_branch")
    if not isinstance(base_branch, str) or not base_branch.strip():
        base_branch = _current_branch(repo_root)
    base_branch = base_branch.strip()
    if base_branch.startswith("refs/heads/"):
        base_branch = base_branch[len("refs/heads/"):]
    if not _local_branch_exists(repo_root, base_branch):
        raise TaskWorktreeError(
            f"Task base_branch must name a local branch in this repository: {base_branch}"
        )
    _verify_revision(repo_root, base_branch, "base_branch")
    return base_branch


def _task_branch(
    task_dir_name: str,
    task_data: dict,
    requested_branch: str | None,
) -> str:
    branch = requested_branch or task_data.get("branch") or f"task/{task_dir_name}"
    if not isinstance(branch, str) or not branch.strip():
        raise TaskWorktreeError("Task branch must be a non-empty string")
    return branch.strip()


def _ensure_expected_branch(
    worktree_root: Path,
    expected_branch: str | None,
) -> str:
    actual_branch = _current_branch(worktree_root)
    if expected_branch and actual_branch != expected_branch:
        raise TaskWorktreeError(
            f"Worktree branch mismatch: expected '{expected_branch}', "
            f"found '{actual_branch}' at {worktree_root}"
        )
    return actual_branch


def resolve_task_worktree(
    repo_root: Path,
    task_dir_name: str,
    task_data: dict | None = None,
) -> TaskWorktree:
    """Resolve and validate the task's already-recorded actual worktree."""
    record_root = _canonical_path(repo_root)
    if task_data is None:
        record = _load_task_record(record_root, task_dir_name)
        if record is None:
            raise TaskWorktreeError(f"Task record not found: {task_dir_name}")
        record_root, _, task_data = record
    elif isinstance(task_data, dict):
        record_root, task_data = _task_record_context(record_root, task_dir_name, task_data)
    else:
        raise TaskWorktreeError(f"Task record is invalid: {task_dir_name}")

    path_value = task_data.get("worktree_path")
    if not isinstance(path_value, str) or not path_value.strip():
        raise TaskWorktreeError(
            f"Task worktree_path is missing for task '{task_dir_name}'"
        )
    worktree_root = _path_from_value(path_value, record_root)
    entry = _registered_worktree(record_root, worktree_root)
    expected_branch = task_data.get("branch")
    if expected_branch is not None and not isinstance(expected_branch, str):
        raise TaskWorktreeError("Task branch must be a string or null")
    branch = _ensure_expected_branch(worktree_root, expected_branch)
    mode = _task_worktree_mode(task_data)
    base_branch = _task_base_branch(record_root, task_data, None)
    return TaskWorktree(
        root=entry.root,
        branch=branch,
        base_branch=base_branch,
        mode=mode,
    )


def claim_task_worktree(
    repo_root: Path,
    task_dir_name: str,
    task_data: dict,
    path_value: str | None = None,
    branch: str | None = None,
    base_branch: str | None = None,
    replace_stale: bool = False,
    invocation_root: Path | None = None,
) -> tuple[dict, TaskWorktree]:
    """Claim the task's one actual worktree, creating only new-worktree mode."""
    invocation_root = _canonical_path(invocation_root or repo_root)
    if not isinstance(task_data, dict):
        raise TaskWorktreeError(f"Task record is invalid: {task_dir_name}")
    repo_root, task_data = _task_record_context(invocation_root, task_dir_name, task_data)
    mode = _task_worktree_mode(task_data)
    selected_base_branch = _task_base_branch(repo_root, task_data, base_branch)
    stored_path = task_data.get("worktree_path")
    requested_path = path_value.strip() if isinstance(path_value, str) else ""
    created_worktree = False
    created_branch = False

    if mode == "current-checkout":
        candidate = repo_root
        if requested_path and not _same_path(_path_from_value(requested_path, repo_root), candidate):
            raise TaskWorktreeError(
                "current-checkout must use the checkout that runs task.py"
            )
        _assert_task_path_unclaimed(repo_root, task_dir_name, candidate)
        entry = _registered_worktree(repo_root, candidate)
        actual_branch = _ensure_expected_branch(entry.root, branch or task_data.get("branch"))
    elif mode == "existing-worktree":
        if requested_path:
            candidate = _path_from_value(requested_path, repo_root)
            if (
                isinstance(stored_path, str)
                and stored_path.strip()
                and not _same_path(_path_from_value(stored_path, repo_root), candidate)
                and not replace_stale
            ):
                raise TaskWorktreeError(
                    "Task already records a different worktree_path. "
                    "Pass --replace-stale only after confirming the old claim is unusable."
                )
        elif isinstance(stored_path, str) and stored_path.strip():
            candidate = _path_from_value(stored_path, repo_root)
        else:
            raise TaskWorktreeError(
                "existing-worktree requires --path or an existing task.worktree_path"
            )
        _assert_task_path_unclaimed(repo_root, task_dir_name, candidate)
        entry = _registered_worktree(repo_root, candidate)
        actual_branch = _ensure_expected_branch(entry.root, branch or task_data.get("branch"))
    else:
        if _is_linked_worktree(invocation_root):
            raise TaskWorktreeError(
                "Cannot create a nested Trellis worktree from an existing linked worktree. "
                "Choose current-checkout or existing-worktree instead."
            )
        if requested_path:
            candidate = _path_from_value(requested_path, repo_root)
        elif isinstance(stored_path, str) and stored_path.strip():
            candidate = _path_from_value(stored_path, repo_root)
        else:
            candidate = _canonical_path(
                repo_root / WORKTREE_PARENT_DIR / WORKTREE_ROOT_DIR / task_dir_name
            )
        _assert_task_path_unclaimed(repo_root, task_dir_name, candidate)
        desired_branch = _task_branch(task_dir_name, task_data, branch)
        existing_entry: WorktreeEntry | None = None
        if candidate.exists():
            try:
                existing_entry = _registered_worktree(repo_root, candidate)
            except TaskWorktreeError:
                if not replace_stale:
                    raise TaskWorktreeError(
                        f"New worktree path already exists but is not a registered worktree: {candidate}. "
                        "Choose another path or remove the stale directory manually."
                    )
                if not candidate.is_dir() or any(candidate.iterdir()):
                    raise TaskWorktreeError(
                        f"Refusing to replace non-empty stale worktree path: {candidate}. "
                        "Move or remove it manually, then retry."
                    )
        if existing_entry:
            actual_branch = _ensure_expected_branch(existing_entry.root, desired_branch)
            entry = existing_entry
        else:
            candidate.parent.mkdir(parents=True, exist_ok=True)
            branch_exists = _local_branch_exists(repo_root, desired_branch)
            if branch_exists:
                command = ["worktree", "add", str(candidate), desired_branch]
            else:
                command = [
                    "worktree",
                    "add",
                    "-b",
                    desired_branch,
                    str(candidate),
                    selected_base_branch,
                ]
            code, _, stderr = run_git(command, cwd=repo_root)
            if code != 0:
                raise TaskWorktreeError(
                    f"Unable to create worktree at {candidate}: {stderr.strip() or 'git worktree add failed'}"
                )
            created_worktree = True
            created_branch = not branch_exists
            try:
                entry = _registered_worktree(repo_root, candidate)
                actual_branch = _ensure_expected_branch(entry.root, desired_branch)
            except Exception:
                rollback_created_worktree(
                    repo_root,
                    TaskWorktree(
                        root=_canonical_path(candidate),
                        branch=desired_branch,
                        base_branch=selected_base_branch,
                        mode=mode,
                        created=True,
                        created_branch=created_branch,
                    ),
                )
                raise

    updated = dict(task_data)
    updated["worktree_path"] = str(entry.root)
    updated["branch"] = actual_branch
    updated["base_branch"] = selected_base_branch
    return updated, TaskWorktree(
        root=entry.root,
        branch=actual_branch,
        base_branch=selected_base_branch,
        mode=mode,
        created=created_worktree,
        created_branch=created_branch,
    )


def rollback_created_worktree(repo_root: Path, worktree: TaskWorktree) -> list[str]:
    """Remove a worktree created by a failed claim persistence step."""
    if not worktree.created:
        return []

    errors: list[str] = []
    code, _, stderr = run_git(
        ["worktree", "remove", "--force", str(worktree.root)],
        cwd=repo_root,
    )
    if code != 0:
        errors.append(
            f"Unable to remove temporary worktree {worktree.root}: "
            f"{stderr.strip() or 'git worktree remove failed'}"
        )
        return errors

    if worktree.created_branch:
        code, _, stderr = run_git(
            ["branch", "-D", worktree.branch],
            cwd=repo_root,
        )
        if code != 0:
            errors.append(
                f"Unable to remove temporary branch {worktree.branch}: "
                f"{stderr.strip() or 'git branch -D failed'}"
            )
    return errors


def merge_task_worktree(
    repo_root: Path,
    task_dir_name: str,
    task_data: dict,
    target_path: str | None = None,
    no_ff: bool = False,
) -> str:
    """Merge a clean claimed task branch into its clean base checkout."""
    repo_root = _canonical_path(repo_root)
    if not isinstance(task_data, dict):
        raise TaskWorktreeError(f"Task record is invalid: {task_dir_name}")
    repo_root, task_data = _task_record_context(repo_root, task_dir_name, task_data)
    source = resolve_task_worktree(repo_root, task_dir_name, task_data)
    target = (
        _path_from_value(target_path, repo_root)
        if isinstance(target_path, str) and target_path.strip()
        else primary_worktree_root(repo_root)
    )
    target_entry = _registered_worktree(repo_root, target)
    if _same_path(source.root, target_entry.root):
        return "Task worktree is already the merge target; nothing to merge."
    target_branch = _current_branch(target_entry.root)
    if target_branch != source.base_branch:
        raise TaskWorktreeError(
            f"Merge target must be on base branch '{source.base_branch}', "
            f"found '{target_branch}' at {target_entry.root}"
        )
    if _git_is_dirty(source.root):
        raise TaskWorktreeError(
            f"Task worktree has uncommitted changes: {source.root}. Commit or stash them before merge."
        )
    if _git_is_dirty(target_entry.root):
        raise TaskWorktreeError(
            f"Merge target has uncommitted changes: {target_entry.root}. Commit or stash them before merge."
        )
    code, _, _ = run_git(
        ["merge-base", "--is-ancestor", source.branch, target_branch],
        cwd=target_entry.root,
    )
    if code == 0:
        return f"Branch '{source.branch}' is already merged into '{target_branch}'."

    command = ["merge"]
    if no_ff:
        command.append("--no-ff")
    command.append(source.branch)
    code, stdout, stderr = run_git(command, cwd=target_entry.root)
    if code != 0:
        merge_head_code, _, _ = run_git(
            ["rev-parse", "--verify", "--quiet", "MERGE_HEAD"],
            cwd=target_entry.root,
        )
        if merge_head_code == 0:
            raise TaskWorktreeError(
                "Merge conflict left in place. Resolve it and commit, or run "
                f"'git -C \"{target_entry.root}\" merge --abort'. "
                f"Git output: {stderr.strip() or stdout.strip()}"
            )
        raise TaskWorktreeError(
            f"Git merge failed: {stderr.strip() or stdout.strip() or 'unknown error'}"
        )
    return f"Merged '{source.branch}' into '{target_branch}' at {target_entry.root}."


def _git_is_dirty(repo_root: Path) -> bool:
    code, stdout, stderr = run_git(
        ["status", "--porcelain", "--untracked-files=all"],
        cwd=repo_root,
    )
    if code != 0:
        raise TaskWorktreeError(
            f"Unable to inspect Git status at {repo_root}: {stderr.strip() or 'git status failed'}"
        )
    return bool(stdout.strip())


def find_task_for_checkout(
    repo_root: Path,
) -> tuple[Path, str, dict] | None:
    """Find a task that explicitly records this linked checkout as its worktree."""
    repo_root = _canonical_path(repo_root)
    if not _is_linked_worktree(repo_root):
        return None
    try:
        primary = primary_worktree_root(repo_root)
    except TaskWorktreeError:
        return None

    for task_root in (repo_root, primary):
        tasks_dir = get_tasks_dir(task_root)
        if not tasks_dir.is_dir():
            continue
        for candidate in sorted(tasks_dir.iterdir()):
            if not candidate.is_dir() or candidate.name == "archive":
                continue
            data = read_json(candidate / FILE_TASK_JSON)
            path_value = data.get("worktree_path") if isinstance(data, dict) else None
            if not isinstance(path_value, str) or not path_value.strip():
                continue
            try:
                worktree_root = _path_from_value(path_value, task_root)
            except OSError:
                continue
            if _same_path(worktree_root, repo_root):
                return task_root, candidate.name, data
    return None


def detect_trellis_managed_worktree(repo_root: Path) -> tuple[Path, str] | None:
    """Legacy fixed-path discovery for tasks that lack a recorded worktree."""
    try:
        if repo_root.parent.name != WORKTREE_ROOT_DIR:
            return None
        if repo_root.parent.parent.name != WORKTREE_PARENT_DIR:
            return None
        main_root = repo_root.parent.parent.parent
        if not (main_root / ".git").exists():
            return None
        return main_root, repo_root.name
    except Exception:
        return None


def infer_managed_worktree_task(repo_root: Path) -> str | None:
    resolved = find_task_for_checkout(repo_root)
    if resolved:
        _, task_dir_name, _ = resolved
        return f".trellis/tasks/{task_dir_name}"

    detected = detect_trellis_managed_worktree(repo_root)
    if not detected:
        return None
    _, task_dir_name = detected
    if not task_dir(repo_root, task_dir_name).is_dir():
        return None
    return f".trellis/tasks/{task_dir_name}"


def resolve_shared_worktree_roots(
    repo_root: Path,
    task_dir_name: str,
    task_data: dict | None = None,
) -> tuple[Path, Path] | None:
    """Resolve task-recorded roots before falling back to the legacy default."""
    repo_root = _canonical_path(repo_root)
    record_root = repo_root
    if task_data is None:
        record = _load_task_record(repo_root, task_dir_name)
        if record:
            record_root, _, task_data = record
    elif isinstance(task_data, dict):
        record_root, task_data = _task_record_context(repo_root, task_dir_name, task_data)

    if isinstance(task_data, dict):
        path_value = task_data.get("worktree_path")
        if isinstance(path_value, str) and path_value.strip():
            try:
                worktree = resolve_task_worktree(record_root, task_dir_name, task_data)
                return primary_worktree_root(record_root), worktree.root
            except TaskWorktreeError:
                return None
        if "workflow" in task_data:
            # Any structured workflow key, including malformed values, must not
            # silently fall back to a derived legacy path.
            return None

    detected = detect_trellis_managed_worktree(repo_root)
    if detected:
        main_root, inferred_task_dir_name = detected
        if inferred_task_dir_name != task_dir_name:
            return None
        return main_root, repo_root

    main_root = repo_root
    worktree_root = repo_root / WORKTREE_PARENT_DIR / WORKTREE_ROOT_DIR / task_dir_name
    if not worktree_root.exists():
        return None
    if not (main_root / DIR_WORKFLOW / "scripts").is_dir():
        return None
    return main_root, worktree_root


def task_snapshot(task_dir_path: Path) -> dict[str, str]:
    snapshot: dict[str, str] = {}
    for name in PLANNING_FILE_NAMES:
        file_path = task_dir_path / name
        if file_path.is_file():
            snapshot[name] = _hash_file(file_path)
    for name in PLANNING_DIR_NAMES:
        dir_path = task_dir_path / name
        if not dir_path.is_dir():
            continue
        for child in sorted(dir_path.rglob("*")):
            if child.is_file():
                snapshot[child.relative_to(task_dir_path).as_posix()] = _hash_file(child)
    return snapshot


def has_any_task_artifact(task_dir_path: Path) -> bool:
    for name in PLANNING_FILE_NAMES:
        if (task_dir_path / name).is_file():
            return True
    for name in PLANNING_DIR_NAMES:
        if (task_dir_path / name).exists():
            return True
    return False


def sync_runtime_bundle(main_root: Path, worktree_root: Path) -> list[str]:
    synced: list[str] = []
    for relative_path in RUNTIME_BUNDLE_FILES:
        src = main_root / relative_path
        dst = worktree_root / relative_path
        if not src.is_file() or _same_file(src, dst):
            continue
        if _copy_file_if_missing(src, dst):
            synced.append(relative_path)
    for relative_path in RUNTIME_BUNDLE_DIRS:
        src = main_root / relative_path
        dst = worktree_root / relative_path
        if not src.is_dir() or _same_tree(src, dst):
            continue
        if _copy_tree_if_missing(src, dst):
            synced.append(relative_path)
    return synced


def sync_task_snapshot(main_root: Path, worktree_root: Path, task_dir_name: str) -> list[str]:
    source_task_dir = task_dir(main_root, task_dir_name)
    target_task_dir = task_dir(worktree_root, task_dir_name)
    if not source_task_dir.is_dir():
        return []

    synced: list[str] = []
    for name in PLANNING_FILE_NAMES:
        src = source_task_dir / name
        if not src.is_file():
            continue
        dst = target_task_dir / name
        if _same_file(src, dst):
            continue
        if _copy_file_if_missing(src, dst):
            synced.append(name)

    for name in PLANNING_DIR_NAMES:
        src = source_task_dir / name
        if not src.is_dir():
            continue
        dst = target_task_dir / name
        if _same_tree(src, dst):
            continue
        if _copy_tree_if_missing(src, dst):
            synced.append(name)

    return synced


def collect_task_drift(main_root: Path, worktree_root: Path, task_dir_name: str) -> list[str]:
    source_snapshot = task_snapshot(task_dir(main_root, task_dir_name))
    target_snapshot = task_snapshot(task_dir(worktree_root, task_dir_name))
    keys = sorted(set(source_snapshot) | set(target_snapshot))
    return [key for key in keys if source_snapshot.get(key) != target_snapshot.get(key)]


def _is_managed_worktree_path(path_str: str, task_dir_name: str) -> bool:
    normalized = path_str.replace("\\", "/").strip().strip("/")

    for relative_path in RUNTIME_BUNDLE_FILES:
        runtime_path = relative_path.strip("/")
        if normalized == runtime_path:
            return True
    for relative_path in RUNTIME_BUNDLE_DIRS:
        runtime_dir = relative_path.strip("/")
        if normalized == runtime_dir or normalized.startswith(runtime_dir + "/"):
            return True

    task_root = f".trellis/tasks/{task_dir_name}"
    if normalized in (".trellis/tasks", task_root):
        return True
    task_prefix = task_root + "/"
    if not normalized.startswith(task_prefix):
        return False
    task_relative = normalized[len(task_prefix):]
    if not task_relative:
        return True
    if task_relative in PLANNING_FILE_NAMES:
        return True
    for dir_name in PLANNING_DIR_NAMES:
        if task_relative == dir_name or task_relative.startswith(dir_name + "/"):
            return True
    return False


def _changed_paths_from_git_status(worktree_root: Path) -> list[str]:
    code, stdout, _ = run_git(
        ["status", "--porcelain", "-z", "--untracked-files=all"],
        cwd=worktree_root,
    )
    if code != 0:
        return []

    changed_paths: list[str] = []
    entries = stdout.split("\0")
    index = 0
    while index < len(entries):
        entry = entries[index]
        if not entry:
            index += 1
            continue

        status = entry[:2]
        if len(entry) > 3:
            changed_paths.append(entry[3:].replace("\\", "/"))

        if "R" in status or "C" in status:
            index += 1
            if index < len(entries) and entries[index]:
                changed_paths.append(entries[index].replace("\\", "/"))

        index += 1

    return changed_paths


def worktree_has_local_code_changes(worktree_root: Path, task_dir_name: str) -> bool:
    if not worktree_root.exists():
        return False
    for relative_path in _changed_paths_from_git_status(worktree_root):
        if not _is_managed_worktree_path(relative_path, task_dir_name):
            return True
    return False
