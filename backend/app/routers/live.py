"""GET /api/live -- a few compact numbers for the LILAK portal's live mode.

    {"ok": true, "items": [{"label", "value", "unit", "state", "sub"}]}

One tile per saved PROFILE (axis): the live position when the axis is
connected, otherwise where it was last left (store/last_positions -- recorded
on every move and when the session closes), with the step name and when.
Assembled from state the service already holds; never touches hardware on the
request path, so it is safe to poll every few seconds.
"""

from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter

from ..hardware import hub
from ..store import load_last_positions, load_profiles
from ..store.step_names import get_step_names

router = APIRouter(tags=["live"])


def _position(snapshot: dict):
    for key in ("position", "pos", "current_position"):
        if snapshot.get(key) is not None:
            return snapshot[key]
    return (snapshot.get("signals") or {}).get("pos")


def _when(iso: str | None) -> str:
    if not iso:
        return ""
    try:
        d = datetime.fromisoformat(iso)
        return d.strftime("%m-%d %H:%M")
    except ValueError:
        return str(iso)[:16]


@router.get("/api/live")
def live() -> dict:
    live_by_ip = {s.get("ip"): s for s in hub.snapshots()}
    last = load_last_positions()
    items = []
    for profile in load_profiles():
        ip, name = profile.get("ip"), profile.get("name") or profile.get("ip")
        snap = live_by_ip.get(ip)
        entry = last.get(ip) or {}
        if snap and snap.get("connected"):
            pos = _position(snap)
            step = snap.get("last_step_number")
            alarms = snap.get("critical_alarms") or []
            busy = (snap.get("signals") or {}).get("busy")
            step_name = get_step_names(ip).get(str(step), "") if step is not None else ""
            items.append({"label": name, "value": "—" if pos is None else f"{float(pos):.1f}", "unit": "mm",
                          "state": "alarm" if alarms else ("running" if busy else "ok"),
                          "sub": " · ".join(x for x in (f"step {step}" if step is not None else "", step_name, "live") if x)})
        elif entry:
            step = entry.get("step")
            step_name = entry.get("name") or (get_step_names(ip).get(str(step), "") if step is not None else "")
            items.append({"label": name, "value": f"{float(entry.get('position')):.1f}" if entry.get("position") is not None else "—",
                          "unit": "mm", "state": "",
                          "sub": " · ".join(x for x in (f"step {step}" if step is not None else "", step_name, _when(entry.get("at"))) if x)})
        else:
            items.append({"label": name, "value": "—", "unit": "", "state": "off", "sub": "no record"})
    if not items:
        items.append({"label": "actuators", "value": "0", "unit": "", "state": "off", "sub": "no profiles"})
    return {"ok": True, "items": items}
