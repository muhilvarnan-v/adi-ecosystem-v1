#!/usr/bin/env python3
"""
Backwards-compatible launcher for the OpenHands multi-repo script.
"""

from __future__ import annotations

import sys

from run_multi_repo import main


if __name__ == "__main__":
    sys.exit(main())
