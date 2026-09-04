"""The current state of every profile, in one file.

`status.jsonl` is the history; this is the present tense. It is overwritten
whenever anything changes, so a script that wants "where are the stages right
now" can read one small file instead of replaying the log or holding a
WebSocket open.

The write is atomic -- a temporary file replaced into place -- so a reader
never catches it half-written.
"""

from __future__ import annotations

import json
import logging
import os
import threading

from ..config import STATUS_SNAPSHOT_FILE

log = logging.getLogger(__name__)

_lock = threading.Lock()


def enabled() -> bool:
    return STATUS_SNAPSHOT_FILE is not None


def path() -> str:
    return "" if STATUS_SNAPSHOT_FILE is None else str(STATUS_SNAPSHOT_FILE)


def write(payload: dict) -> None:
    if STATUS_SNAPSHOT_FILE is None:
        return
    text = json.dumps(payload, ensure_ascii=False, indent=2) + "\n"
    with _lock:
        try:
            STATUS_SNAPSHOT_FILE.parent.mkdir(parents=True, exist_ok=True)
            temporary = STATUS_SNAPSHOT_FILE.with_suffix(STATUS_SNAPSHOT_FILE.suffix + ".tmp")
            temporary.write_text(text, encoding="utf-8")
            os.replace(temporary, STATUS_SNAPSHOT_FILE)
        except OSError as exc:  # pragma: no cover - disk trouble
            log.warning("Cannot write %s: %s", STATUS_SNAPSHOT_FILE, exc)
