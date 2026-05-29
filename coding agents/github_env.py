"""Deprecated module placeholder after OpenHands migration."""

from __future__ import annotations


def _deprecated() -> None:
    raise RuntimeError(
        "This module was retired. Use run_multi_repo.py with OpenHands SDK."
    )


def normalize_repo_url(url: str) -> str:
    _deprecated()
    return url
