"""The append-only status log, as JSON Lines.

One labelled object per line: readable without a key to the columns, greppable,
and loadable by anything that can read JSON -- ``[json.loads(line) for line in
open(path)]``. Rendering it as a table is the reader's job, not the writer's.

Writing is best effort: a full disk or a read-only data directory must never
stop an axis from being driven.
"""

from __future__ import annotations

import json
import logging
import threading

from ..config import STATUS_LOG_FILE, STATUS_LOG_MAX_BYTES

log = logging.getLogger(__name__)

_lock = threading.Lock()


def enabled() -> bool:
    return STATUS_LOG_FILE is not None


def path() -> str:
    return "" if STATUS_LOG_FILE is None else str(STATUS_LOG_FILE)


def append(records: list[dict]) -> None:
    if STATUS_LOG_FILE is None or not records:
        return
    # ensure_ascii=False so a Korean step name stays a Korean step name.
    lines = [json.dumps(record, ensure_ascii=False) for record in records]
    with _lock:
        try:
            STATUS_LOG_FILE.parent.mkdir(parents=True, exist_ok=True)
            _rotate()
            with STATUS_LOG_FILE.open("a", encoding="utf-8") as handle:
                handle.write("\n".join(lines) + "\n")
        except OSError as exc:  # pragma: no cover - disk trouble
            log.warning("Cannot write %s: %s", STATUS_LOG_FILE, exc)


def _rotate() -> None:
    """Keep one previous file, so the log cannot grow without bound."""
    if STATUS_LOG_FILE is None or not STATUS_LOG_FILE.exists():
        return
    if STATUS_LOG_FILE.stat().st_size < STATUS_LOG_MAX_BYTES:
        return
    STATUS_LOG_FILE.replace(STATUS_LOG_FILE.with_suffix(STATUS_LOG_FILE.suffix + ".1"))


def tail(lines: int = 200) -> list[dict]:
    """The last `lines` records, oldest first.  Unparseable lines are skipped."""
    if STATUS_LOG_FILE is None or not STATUS_LOG_FILE.exists():
        return []
    try:
        with STATUS_LOG_FILE.open("r", encoding="utf-8", errors="replace") as handle:
            kept = handle.readlines()[-max(1, lines):]
    except OSError as exc:  # pragma: no cover - disk trouble
        log.warning("Cannot read %s: %s", STATUS_LOG_FILE, exc)
        return []

    records = []
    for line in kept:
        line = line.strip()
        if not line:
            continue
        try:
            record = json.loads(line)
        except ValueError:
            continue  # a half-written line from a killed process
        if isinstance(record, dict):
            records.append(record)
    return records
