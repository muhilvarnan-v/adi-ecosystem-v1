"""Thread-local context for tagging OpenHands stream events with workflow agent + phase."""

from __future__ import annotations

from contextlib import contextmanager
from contextvars import ContextVar
from typing import Any, Iterator

_ctx: ContextVar[dict[str, Any]] = ContextVar("_agent_log_ctx", default={})


@contextmanager
def workflow_agent_context(
    *,
    agent: str | None = None,
    phase: str | None = None,
    cycle: int | None = None,
    agent_record_id: str | None = None,
) -> Iterator[dict[str, Any]]:
    """Merge keys for the duration of one workflow phase / single-agent run."""
    prev = dict(_ctx.get())
    patch: dict[str, Any] = {}
    if agent is not None:
        patch["agent"] = agent
    if phase is not None:
        patch["phase"] = phase
    if cycle is not None:
        patch["cycle"] = cycle
    if agent_record_id is not None:
        patch["agent_record_id"] = agent_record_id
    merged = {**prev, **patch}
    token = _ctx.set(merged)
    try:
        yield merged
    finally:
        _ctx.reset(token)


def current_workflow_agent_context() -> dict[str, Any]:
    return dict(_ctx.get())
