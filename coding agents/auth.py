"""Deprecated module placeholder after OpenHands migration."""

from __future__ import annotations


def _deprecated() -> None:
    raise RuntimeError(
        "This module was retired. Use run_multi_repo.py with LLM_API_KEY and OpenHands SDK."
    )


def load_env() -> None:
    _deprecated()


def create_client() -> None:
    _deprecated()


def describe_auth() -> str:
    _deprecated()
    return ""


def require_auth() -> None:
    _deprecated()
