#!/usr/bin/env python3
"""Toggle Trellis injection on/off for the current developer."""

from __future__ import annotations

import sys
from datetime import datetime
from pathlib import Path

from common.paths import (
    get_active_journal_file,
    get_developer,
    get_repo_root,
    get_workspace_dir,
    read_switch_enabled,
    write_switch_enabled,
    FILE_JOURNAL_PREFIX,
)


def _append_journal(workspace: Path, repo_root: Path, message: str) -> None:
    journal = get_active_journal_file(repo_root)
    if journal is None:
        # fallback: journal-1.md
        journal = workspace / f"{FILE_JOURNAL_PREFIX}1.md"
    try:
        entry = f"\n- {datetime.now().strftime('%Y-%m-%d %H:%M')} {message}\n"
        with journal.open("a", encoding="utf-8") as f:
            f.write(entry)
    except Exception:
        pass


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
