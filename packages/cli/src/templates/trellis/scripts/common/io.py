"""
JSON file I/O utilities.

Provides read_json and write_json as the single source of truth
for JSON file operations across all Trellis scripts.
"""

from __future__ import annotations

import json
import os
import stat
import tempfile
from pathlib import Path


def read_json(path: Path) -> dict | None:
    """Read and parse a JSON file.

    Returns None if the file doesn't exist, is invalid JSON, or can't be read.
    """
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        return None


def _default_file_mode() -> int:
    """Match Path.write_text's mode behavior while using atomic replacement."""
    current_umask = os.umask(0)
    os.umask(current_umask)
    return 0o666 & ~current_umask


def write_json(path: Path, data: dict) -> bool:
    """Atomically write dict to JSON file with pretty formatting."""
    temporary_path: Path | None = None
    original_mode: int | None = None
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        if path.exists():
            original_mode = stat.S_IMODE(path.stat().st_mode)
        with tempfile.NamedTemporaryFile(
            mode="w",
            encoding="utf-8",
            dir=path.parent,
            prefix=f".{path.name}.",
            suffix=".tmp",
            delete=False,
        ) as handle:
            temporary_path = Path(handle.name)
            json.dump(data, handle, indent=2, ensure_ascii=False)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        target_mode = original_mode if original_mode is not None else _default_file_mode()
        os.chmod(temporary_path, target_mode)
        os.replace(temporary_path, path)
        return True
    except (OSError, IOError, TypeError, ValueError):
        if temporary_path is not None:
            try:
                temporary_path.unlink(missing_ok=True)
            except OSError:
                pass
        return False
