"""GET /api/live -- a few compact numbers for the LILAK portal's live mode.

    {"ok": true, "items": [{"label", "value", "unit", "state"}], "note": ""}

Assembled from state the service already holds; never touches hardware or a
remote host on the request path, so it is safe to poll every few seconds.
"""

from __future__ import annotations

from fastapi import APIRouter

from ..hardware import hub

router = APIRouter(tags=["live"])


def _position(snapshot: dict):
    for key in ("position", "pos", "current_position"):
        if snapshot.get(key) is not None:
            return snapshot[key]
    signals = snapshot.get("signals") or {}
    return signals.get("pos")


@router.get("/api/live")
def live() -> dict:
    items = []
    for s in hub.snapshots():
        pos = _position(s)
        connected = bool(s.get("connected"))
        alarms = s.get("critical_alarms") or []
        items.append({
            "label": s.get("name") or s.get("ip"),
            "value": "—" if pos is None else f"{float(pos):.2f}",
            "unit": "mm" if pos is not None else "",
            "state": "alarm" if alarms else ("running" if (s.get("signals") or {}).get("busy") else ("ok" if connected else "down")),
            "sub": (f"step {s['last_step_number']}" if s.get("last_step_number") is not None else ("connected" if connected else "offline")),
        })
    if not items:
        items.append({"label": "actuators", "value": "0", "unit": "", "state": "off", "sub": "none connected"})
    return {"ok": True, "items": items}
