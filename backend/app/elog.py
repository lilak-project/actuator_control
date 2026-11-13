"""The LILAK elog endpoint: one POST that answers both of elog's questions.

elog talks to a service through a single URL. Two different bodies arrive on it:

    {"event": "elog_handshake", "elog_url": …}
        -> who we are and what fields we can fill (Discover, once, at registration)

    {"format_id", "format_name", "task_log_id", "run_number", "requested_at", "mode"}
        -> the values themselves (every fill, on a task or on a schedule)

Two rules shape everything below.

**Five seconds.** elog gives up after that (`WEBHOOK_TIMEOUT_SEC`) and turns the
task into a manual one with the error as a comment. `mode` may also be
"realtime", which repeats as often as twice a second. So a reader here must be
cheap and must never block on hardware it does not already hold.

**The field list is fixed.** elog builds a log format from `log_fields` at
registration and matches it later by name *and* field signature: declare a
different set and a second format appears rather than the first one changing.
So `log_fields` must come from configuration, never from what is currently
plugged in, connected or selected -- otherwise unplugging a cable forks the
format and last week's entries stop lining up with this week's.

Copied into each service rather than shared from one place: these services are
each movable as a single folder (SERVICE_CONTRACT §9), and a shared import
would tie them together at runtime for eighty lines.
"""

from __future__ import annotations

import logging
import socket
from collections.abc import Awaitable, Callable
from typing import Any

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

log = logging.getLogger("elog")

HANDSHAKE = "elog_handshake"

#: A field elog can put on a log format.
#: `type` is one of number_entry | number | text | body | title | tags | level.
#: `metric` (number types only) makes it an Infography variable.
Field = dict[str, Any]


def number(key: str, label: str, unit: str = "", metric: bool = True) -> Field:
    """A numeric field. number_entry is the shape elog normalises to {value,error}."""
    return {"key": key, "label": label, "type": "number_entry", "unit": unit, "metric": metric}


def text(key: str, label: str) -> Field:
    return {"key": key, "label": label, "type": "text"}


def body(label: str = "Summary") -> Field:
    return {"key": "body", "label": label, "type": "body"}


def value(number_value: float | None, error: float = 0.0) -> dict:
    """One number_entry value. None stays None -- a channel that reported
    nothing is not the same as one that reported zero."""
    return {"value": None if number_value is None else float(number_value), "error": error}


def make_router(
    *,
    service_name: str,
    description: str,
    log_fields: list[Field] | Callable[[], Awaitable[list[Field]]],
    read: Callable[[dict], Awaitable[dict]],
    directory: str = "",
    path: str = "/api/elog",
) -> APIRouter:
    """The endpoint. `read(envelope)` returns the `fields` dict for one request.

    `log_fields` is normally a plain list -- a constant, which is what the
    "fixed field list" rule above asks for. It may instead be an async callable
    for a service whose fields come from its own saved configuration (which
    actuators are set up, say). That is still configuration and still stable;
    it just cannot be written down at import time. Such a callable should RAISE
    rather than return a short list when it cannot read that configuration, so
    Discover fails loudly instead of quietly registering half a format.

    Mount this BEFORE any catch-all `/api/{path}` route: FastAPI matches in
    registration order, and the read-only mirrors answer 405 to every POST they
    do not recognise -- including this one.
    """
    router = APIRouter(tags=["elog"])

    @router.post(path, summary="LILAK elog handshake and data request")
    async def elog_endpoint(request: Request):
        try:
            envelope = await request.json()
        except Exception:
            return JSONResponse(status_code=400, content={"detail": "body must be JSON"})
        if not isinstance(envelope, dict):
            return JSONResponse(status_code=400, content={"detail": "body must be a JSON object"})

        event = envelope.get("event")
        if event == HANDSHAKE:
            log.info("elog handshake from %s", envelope.get("elog_url") or "?")
            try:
                fields = log_fields if isinstance(log_fields, list) else await log_fields()
            except Exception as err:
                log.warning("handshake refused: %s", err)
                return JSONResponse(status_code=503, content={"detail": str(err)})
            return {
                "name": service_name,
                "description": description,
                "hostname": socket.gethostname(),
                "directory": directory,
                # A service, not a system: elog asks us, we never push runs at it.
                "is_system": False,
                "log_fields": fields,
            }
        if event:
            # Only the handshake is an event. Anything else is a system-only
            # message (elog_credentials) or a typo, and answering it with
            # readings would be worse than saying so.
            return JSONResponse(
                status_code=400,
                content={"detail": f"unknown event {event!r}; this is a plain service, not a system"},
            )

        fields = await read(envelope)
        return {"fields": fields}

    return router


# ── This service's answer ────────────────────────────────────────────────────

from datetime import datetime                                      # noqa: E402

from .reporting import build_report                                # noqa: E402
from .routers._helpers import run_hw                               # noqa: E402


async def _report() -> dict:
    """One row per saved actuator, connected or not -- the same report the
    Overview shows, read in-process (this was actuator_monitoring's, over HTTP)."""
    return await run_hw(build_report)


def _key(ip: str) -> str:
    """A field key that never changes and never collides.

    The whole address, not the last octet: two crates on different subnets can
    both end in .150, and a key that collides silently merges two axes into one
    column. Nobody reads the key -- the label carries the name.
    """
    return "pos_" + ip.replace(".", "_")


def _step_key(ip: str) -> str:
    """Companion to _key for the step this axis is standing at."""
    return "step_" + ip.replace(".", "_")


async def log_fields() -> list:
    """One position field per saved actuator, from the control service's profiles.

    Raises when the control service cannot be reached, so Discover fails with
    that message instead of registering a format with no axes in it -- which
    would look like it worked and then never fill anything.

    Adding or removing an actuator changes this list, and elog matches formats
    by field signature: re-run Discover afterwards and a new "<name> log" format
    appears alongside the old one. That is the intended trade -- the alternative
    is a fixed slot count that means nothing on the bench.
    """
    rows = (await _report())["actuators"]

    # Position AND step, per axis. The number alone does not say where the axis
    # is meant to BE: "162.00 mm" is a measurement, "1cm Col" is the setting an
    # operator chose, and a logbook wants both — the body already showed them
    # side by side, but only the number was a field you could filter or plot on.
    fields = []
    for row in rows:
        who = row["name"] or row["ip"]
        fields.append(number(_key(row["ip"]), f"{who} position", "mm"))
        fields.append(text(_step_key(row["ip"]), f"{who} step"))
    return fields + [text("taken_at", "Reading taken at"), body("Every actuator")]


async def read(envelope: dict) -> dict:
    """Where every axis is, or was last left standing.

    A connected axis reports its live position; a disconnected one reports the
    position the control service recorded when it was last driven, which is the
    number a shifter actually wants in the log. `body` says which of the two
    each row is, because "117.0 mm" means something different when it was read
    four hours ago.
    """
    report = await _report()
    rows = report["actuators"]

    fields = {}
    for row in rows:
        fields[_key(row["ip"])] = value(row["position_mm"])
        # Same wording the body uses, so the field and the prose agree.
        fields[_step_key(row["ip"])] = (
            "stopped" if row["stopped"]
            else "—" if row["step"] is None
            else f"{row['step']}" + (f" · {row['step_name']}" if row["step_name"] else "")
        )
    fields["taken_at"] = report.get("at", "")
    fields["body"] = _body(rows)
    return fields


def _body(rows: list[dict]) -> str:
    """One block per actuator, inside a fenced code block.

    The fence is not decoration. elog renders a log body as Markdown
    (LogDetail.jsx -> ReactMarkdown + remarkGfm), which folds every run of
    spaces and every single newline into one space -- so a plain aligned table
    arrives as one long line with the columns gone. Inside a fence it is
    reproduced character for character, which is the only way the indentation
    below survives the trip.

    Three lines per axis: what it is, where it is, and when that was true. The
    last line is the one that stops "117.00 mm" from being read as now when it
    was recorded overnight.
    """
    if not rows:
        return "The control service has no saved actuators."

    blocks = []
    for row in rows:
        name = row["name"] or row["ip"]
        step = "stopped" if row["stopped"] else (
            "—" if row["step"] is None
            else f"{row['step']}" + (f" · {row['step_name']}" if row["step_name"] else "")
        )
        position = "—" if row["position_mm"] is None else f"{row['position_mm']:.2f} mm"
        blocks.append(
            f"{name}   {row['ip']}\n"
            f"    step {step}\n"
            f"    {position}   ({_when(row)})"
        )

    return "```\n" + "\n\n".join(blocks) + "\n```"


def _when(row: dict) -> str:
    """Whether this reading is happening now, or is history -- and how old.

    A bare ISO stamp makes the reader do the arithmetic; "11 h ago" is what
    they were going to work out anyway.
    """
    if row["connected"]:
        return "live"
    stamp = row.get("seen_at")
    if not stamp:
        return "never driven"
    try:
        taken = datetime.fromisoformat(stamp)
    except ValueError:
        return stamp
    seconds = (datetime.now(taken.tzinfo) - taken).total_seconds()
    if seconds < 90:
        ago = "just now"
    elif seconds < 3600:
        ago = f"{round(seconds / 60)} min ago"
    elif seconds < 48 * 3600:
        ago = f"{round(seconds / 3600)} h ago"
    else:
        ago = f"{round(seconds / 86400)} d ago"
    return f"{taken.strftime('%Y-%m-%d %H:%M')}, {ago}"


# The name and fields are actuator_monitoring's, unchanged: elog matches a log
# format by both, so the formats made before the two services merged keep filling.
router = make_router(
    service_name="Actuator Monitoring",
    description="Where every actuator is, or was last driven to.",
    log_fields=log_fields,
    read=read,
)
