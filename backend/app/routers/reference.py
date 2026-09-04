"""Reference data for the help screen.

Static tables, so this is the one router that answers with nothing connected.
"""

from __future__ import annotations

from fastapi import APIRouter

from ..hardware.alarms import alarm_table

router = APIRouter(prefix="/api/reference", tags=["reference"])


@router.get("/alarms")
async def alarms() -> list[dict]:
    """Every alarm code the controller reports, with its group and countermeasure."""
    return alarm_table()
