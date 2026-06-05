from __future__ import annotations

import hashlib
import shutil
from pathlib import Path

from common.git import run_git

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


def task_dir(repo_root: Path, task_dir_name: str) -> Path:
    return repo_root / DIR_WORKFLOW / "tasks" / task_dir_name


def detect_trellis_managed_worktree(repo_root: Path) -> tuple[Path, str] | None:
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
) -> tuple[Path, Path] | None:
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
        _copy_file(src, dst)
        synced.append(relative_path)
    for relative_path in RUNTIME_BUNDLE_DIRS:
        src = main_root / relative_path
        dst = worktree_root / relative_path
        if not src.is_dir() or _same_tree(src, dst):
            continue
        _copy_tree(src, dst)
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
        _copy_file(src, dst)
        synced.append(name)

    for name in PLANNING_DIR_NAMES:
        src = source_task_dir / name
        if not src.is_dir():
            continue
        dst = target_task_dir / name
        if _same_tree(src, dst):
            continue
        _copy_tree(src, dst)
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
