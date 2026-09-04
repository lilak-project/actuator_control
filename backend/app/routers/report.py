"""Status snapshot endpoints: JSON for tooling, fixed columns for the log."""

from __future__ import annotations

from fastapi import APIRouter, Query
from fastapi.responses import PlainTextResponse

from ..reporting import build_report, format_log, format_report
from ..store import status_log
from ._helpers import run_hw

router = APIRouter(tags=["report"])


@router.get("/api/report")
async def report() -> dict:
    """Current status of every saved actuator, connected or not."""
    return await run_hw(build_report)


@router.get("/api/report.txt", response_class=PlainTextResponse)
async def report_text() -> str:
    """The same thing in fixed columns, ready to paste into a log."""
    return format_report(await run_hw(build_report))


@router.get("/api/log")
async def status_log_records(lines: int = Query(default=200, ge=1, le=10000)) -> dict:
    """The tail of the status log as records, oldest first.

    The file is JSON Lines, so this is the same thing the file holds -- one
    labelled object per change.
    """
    return {
        "file": status_log.path(),
        "enabled": status_log.enabled(),
        "records": await run_hw(status_log.tail, lines),
    }


@router.get("/api/log.txt", response_class=PlainTextResponse)
async def status_log_text(lines: int = Query(default=200, ge=1, le=10000)) -> str:
    """The same records as a table, for reading."""
    if not status_log.enabled():
        return "The status log is switched off (ACTUATOR_STATUS_LOG is empty).\n"
    return format_log(await run_hw(status_log.tail, lines))
