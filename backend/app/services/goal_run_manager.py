"""In-memory queues for goal execution log streaming."""

from __future__ import annotations

import json
import threading
from typing import Any

_MAX_BUFFER = 2000


class GoalRunManager:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._active: set[str] = set()
        self._buffers: dict[str, list[dict[str, Any]]] = {}
        self._conditions: dict[str, threading.Condition] = {}

    def has_active_run(self, goal_id: str) -> bool:
        with self._lock:
            return goal_id in self._active

    def get_or_register(self, goal_id: str) -> None:
        """Ensure a goal run slot exists (called when execution starts)."""
        with self._lock:
            self._active.add(goal_id)
            if goal_id not in self._buffers:
                self._buffers[goal_id] = []
            if goal_id not in self._conditions:
                self._conditions[goal_id] = threading.Condition(self._lock)

    def replay_buffer(self, goal_id: str) -> list[dict[str, Any]]:
        with self._lock:
            return list(self._buffers.get(goal_id, []))

    def emit(self, goal_id: str, event: dict[str, Any]) -> None:
        with self._lock:
            if goal_id not in self._active:
                self._active.add(goal_id)
            buf = self._buffers.setdefault(goal_id, [])
            buf.append(event)
            if len(buf) > _MAX_BUFFER:
                self._buffers[goal_id] = buf[-_MAX_BUFFER:]
            cond = self._conditions.setdefault(goal_id, threading.Condition(self._lock))
            cond.notify_all()

    def finish(self, goal_id: str) -> None:
        self.emit(goal_id, {"type": "done"})
        with self._lock:
            self._active.discard(goal_id)
            self._conditions.pop(goal_id, None)
            # Keep buffer until stream consumers finish; cleared on last read or timeout
            buf = self._buffers.get(goal_id, [])
            if buf and buf[-1].get("type") == "done":
                pass  # retain for late reconnects during terminal replay window

    def clear_buffer(self, goal_id: str) -> None:
        with self._lock:
            self._buffers.pop(goal_id, None)

    def iter_sse(self, goal_id: str):
        self.get_or_register(goal_id)
        index = 0
        while True:
            with self._lock:
                buf = self._buffers.get(goal_id, [])
                cond = self._conditions.get(goal_id)
                while index >= len(buf):
                    if not self._active and goal_id not in self._buffers:
                        return
                    if not self._active and buf and buf[-1].get("type") == "done":
                        return
                    if cond is None:
                        return
                    cond.wait(timeout=600)
                    buf = self._buffers.get(goal_id, [])
                    if index >= len(buf) and not self._active:
                        if buf and buf[-1].get("type") == "done":
                            return
                        yield f"data: {json.dumps({'type': 'error', 'message': 'Stream timeout'})}\n\n"
                        return
                item = buf[index]
                index += 1
            yield f"data: {json.dumps(item, default=str)}\n\n"
            if isinstance(item, dict) and item.get("type") == "done":
                self.clear_buffer(goal_id)
                return


goal_run_manager = GoalRunManager()
