#!/usr/bin/env python3
"""Block Trellis workflow entry when Claude trellis-switch is disabled."""

from __future__ import annotations

import sys

from common.cli_adapter import detect_platform
from common.paths import get_repo_root, read_switch_enabled

DISABLED_MESSAGE = "Trellis 当前已关闭；如需恢复，请执行 /trellis-switch"


def main() -> int:
    repo_root = get_repo_root()
    if detect_platform(repo_root) != "claude":
        return 0
    if read_switch_enabled(repo_root):
        return 0
    print(DISABLED_MESSAGE)
    return 1


if __name__ == "__main__":
    sys.exit(main())
