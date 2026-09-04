"""Keeps the two status files up to date: the log, and the snapshot.

Polling the reduced state rather than hooking each command is deliberate: it
catches what the controller does on its own -- an alarm latching, a move
finishing, the idle watchdog releasing the servo -- as well as what the
operator asks for, and there is exactly one place that decides what a change
is.

Position is not part of the change comparison. It moves continuously during
travel, so logging on it would write a line per tick; it is recorded on every
line instead. The snapshot does follow it -- that file is the present tense, so
it is rewritten whenever any of it differs from what is already on disk.
"""

from __future__ import annotations

import json
import time
from datetime import datetime, timezone

from .reporting import build_report
from .store import snapshot, status_log

#: Rewrite the snapshot at least this often even when nothing has changed, so
#: its timestamp doubles as a heartbeat: a reader can tell "quiet" from "the
#: server died an hour ago" without opening the log.
SNAPSHOT_HEARTBEAT = 60.0


def _fingerprint(row: dict) -> tuple:
    return (
        row["connected"],
        row["servo_on"],
        row["homed"],
        row["moving"],
        row["stopped"],
        row["step"],
        tuple(row["alarms"]),
    )


def _events(before: tuple | None, row: dict) -> list[str]:
    """What changed, in the words an operator would use."""
    after = _fingerprint(row)
    if before is None:
        return ["seen"] if row["connected"] else []

    events: list[str] = []
    was_connected, was_servo, was_homed, was_moving, was_stopped, was_step, was_alarms = before

    if row["connected"] != was_connected:
        events.append("connect" if row["connected"] else "disconnect")
    # Only a real transition: an axis that was disconnected has no servo state
    # to have changed from, and "connect, sv off" says nothing twice.
    if was_connected and row["connected"] and row["servo_on"] != was_servo:
        events.append("sv on" if row["servo_on"] else "sv off")
    if row["homed"] and not was_homed:
        events.append("init")
    if row["stopped"] and not was_stopped:
        events.append("stop")
    moved = row["step"] != was_step and row["step"] is not None
    if moved:
        events.append(f"move {row['step']}")
    if row["moving"] != was_moving:
        # "move 3, moving" says it twice; the arrival still gets its own line.
        if not (row["moving"] and moved):
            events.append("moving" if row["moving"] else "settled")

    new_alarms = [code for code in row["alarms"] if code not in was_alarms]
    if new_alarms:
        events.append("alarm " + ", ".join(str(code) for code in new_alarms))
    elif was_alarms and not row["alarms"]:
        events.append("alarm clear")

    return events


def _record(row: dict, events: list[str]) -> dict:
    """One log line: every value labelled, and the unit in the name.

    The shape mirrors a report row so the two can be read side by side; `events`
    is what changed since the previous line for this axis.
    """
    return {
        "at": datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds"),
        "events": events,
        "actuator": row["name"],
        "ip": row["ip"],
        "connected": row["connected"],
        "servo_on": row["servo_on"],
        "homed": row["homed"],
        "moving": row["moving"],
        "stopped": row["stopped"],
        "step": row["step"],
        "step_name": row["step_name"],
        "position_mm": row["position_mm"],
        "alarms": row["alarms"],
    }


class Logbook:
    """Remembers what it last wrote, so only changes are written."""

    def __init__(self) -> None:
        self._last: dict[str, tuple] = {}
        #: What the snapshot file already holds, so it is not rewritten for
        #: readings that have not moved.
        self._written: str | None = None
        self._written_at = 0.0

    def record_changes(self) -> list[dict]:
        """Compare every profile against the last written state; append the diff."""
        records = []
        report = build_report()
        seen = set()
        for row in report["actuators"]:
            ip = row["ip"]
            seen.add(ip)
            events = _events(self._last.get(ip), row)
            self._last[ip] = _fingerprint(row)
            if events:
                records.append(_record(row, events))

        # A deleted profile should not keep its state around for a later one
        # on the same address.
        for ip in set(self._last) - seen:
            del self._last[ip]

        status_log.append(records)
        self._write_snapshot(report)
        return records

    def _write_snapshot(self, report: dict) -> None:
        """Overwrite the snapshot when the axes read differently than on disk."""
        if not snapshot.enabled():
            return
        # `at` changes every tick, so it cannot be part of the comparison.
        fingerprint = json.dumps(report["actuators"], ensure_ascii=False, sort_keys=True)
        now = time.monotonic()
        if fingerprint == self._written and now - self._written_at < SNAPSHOT_HEARTBEAT:
            return
        snapshot.write(report)
        self._written = fingerprint
        self._written_at = now


logbook = Logbook()
