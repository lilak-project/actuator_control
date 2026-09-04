"""Compatibility shim for browsers still running the pre-2.0 UI.

The old page polls ``GET /api/status?ip=...`` twice a second per axis and has
no way to discover that the server behind it was replaced -- it just stops
updating. Answering in the envelope it expects (``{"ok": false, "error": ...}``)
puts a readable instruction on the operator's screen instead.

Delete this module, and its include in `main.py`, once no old clients remain.
"""

from __future__ import annotations

from fastapi import APIRouter

router = APIRouter(tags=["legacy"], include_in_schema=False)

UPGRADE_NOTICE = (
    "This controller was upgraded. Press Ctrl+Shift+R (Cmd+Shift+R on a Mac) "
    "to load the new interface."
)


@router.get("/api/status")
async def legacy_status() -> dict:
    """Old status poll. HTTP 200 so the page shows the message, not a network error."""
    return {"ok": False, "error": UPGRADE_NOTICE}


@router.post("/api/command")
@router.post("/api/connect")
@router.post("/api/disconnect")
@router.post("/api/step")
@router.post("/api/step-name")
@router.post("/api/position-limit")
async def legacy_action() -> dict:
    """Refuse old write calls with the same notice, rather than a bare 404."""
    return {"ok": False, "error": UPGRADE_NOTICE}
