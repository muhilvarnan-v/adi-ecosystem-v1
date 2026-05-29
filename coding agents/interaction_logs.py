"""Deprecated module placeholder after OpenHands migration."""

from __future__ import annotations


def _deprecated() -> None:
    raise RuntimeError(
        "This module was retired. Use run_multi_repo.py with OpenHands SDK."
    )


def create_and_wait(*_args, **_kwargs):  # type: ignore[no-untyped-def]
    _deprecated()
