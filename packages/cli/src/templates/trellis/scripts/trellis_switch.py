#!/usr/bin/env python3
"""Toggle Trellis injection on/off for the current developer."""

from __future__ import annotations

import sys
from datetime import datetime
from pathlib import Path

from common.paths import (
    FILE_JOURNAL_PREFIX,
    get_active_journal_file,
    get_developer,
    get_repo_root,
    get_workspace_dir,
    read_switch_enabled,
    write_switch_enabled,
)

DISABLED_SUFFIX = ".disabled"
TRELLIS_SWITCH_COMMAND = "trellis-switch.md"
SKILL_FILE = "SKILL.md"
DISABLED_SKILL_FILE = f"{SKILL_FILE}{DISABLED_SUFFIX}"


def _append_journal(workspace: Path, repo_root: Path, message: str) -> None:
    journal = get_active_journal_file(repo_root)
    if journal is None:
        journal = workspace / f"{FILE_JOURNAL_PREFIX}1.md"
    try:
        entry = f"\n- {datetime.now().strftime('%Y-%m-%d %H:%M')} {message}\n"
        with journal.open("a", encoding="utf-8") as f:
            f.write(entry)
    except Exception:
        pass


def _disabled_path(path: Path) -> Path:
    return path.with_name(f"{path.name}{DISABLED_SUFFIX}")


def _enabled_path(path: Path) -> Path:
    return path.with_name(path.name[: -len(DISABLED_SUFFIX)])


def _set_claude_command_visibility(repo_root: Path, enabled: bool) -> None:
    commands_dir = repo_root / ".claude" / "commands" / "trellis"
    if not commands_dir.is_dir():
        return

    if enabled:
        for disabled_command in commands_dir.glob(f"*.md{DISABLED_SUFFIX}"):
            enabled_command = _enabled_path(disabled_command)
            if not enabled_command.exists():
                disabled_command.rename(enabled_command)
        return

    for command_file in commands_dir.glob("*.md"):
        if command_file.name == TRELLIS_SWITCH_COMMAND:
            continue
        disabled_command = _disabled_path(command_file)
        if not disabled_command.exists():
            command_file.rename(disabled_command)


def _set_claude_skill_visibility(repo_root: Path, enabled: bool) -> None:
    skills_dir = repo_root / ".claude" / "skills"
    if not skills_dir.is_dir():
        return

    for skill_dir in skills_dir.glob("trellis-*"):
        if not skill_dir.is_dir():
            continue

        skill_file = skill_dir / SKILL_FILE
        disabled_skill_file = skill_dir / DISABLED_SKILL_FILE
        if enabled:
            if disabled_skill_file.is_file() and not skill_file.exists():
                disabled_skill_file.rename(skill_file)
            continue

        if skill_file.is_file() and not disabled_skill_file.exists():
            skill_file.rename(disabled_skill_file)


def _set_claude_surface_visibility(repo_root: Path, enabled: bool) -> None:
    _set_claude_command_visibility(repo_root, enabled)
    _set_claude_skill_visibility(repo_root, enabled)


def main() -> None:
    repo_root = get_repo_root()
    developer = get_developer(repo_root)
    if not developer:
        print("Error: Developer not initialized. Run: python ./.trellis/scripts/init_developer.py <your-name>", file=sys.stderr)
        sys.exit(1)

    workspace = get_workspace_dir(repo_root)
    assert workspace is not None

    current = read_switch_enabled(repo_root)
    new_state = not current
    write_switch_enabled(new_state, repo_root)
    _set_claude_surface_visibility(repo_root, new_state)

    if new_state:
        msg = "已打开 Trellis, 执行clear或打开新会话后生效。"
        journal_msg = "Trellis 已开启"
    else:
        msg = "已关闭 Trellis, 执行clear或打开新会话后生效。"
        journal_msg = "Trellis 已关闭"

    _append_journal(workspace, repo_root, journal_msg)
    print(msg)


if __name__ == "__main__":
    main()
