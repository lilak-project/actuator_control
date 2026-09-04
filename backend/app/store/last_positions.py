"""Where each axis was last left standing.

Recorded when a move is commanded and again whenever the servo is released or
the session closed, so an operator can still see where a stage is parked after
the software has let go of it.
"""

from __future__ import annotations

import threading
from datetime import datetime, timezone

from ..config import LAST_POSITION_FILE
from ._jsonfile import read_dict, write_dict

_lock = threading.Lock()


def record(ip: str, step: int | None, position: float) -> None:
    ip = str(ip).strip()
    if not ip:
        return
    with _lock:
        data = read_dict(LAST_POSITION_FILE)
        data[ip] = {
            "step": step,
            "position": round(float(position), 2),
            "at": datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds"),
        }
        write_dict(LAST_POSITION_FILE, data)


def load_all() -> dict[str, dict]:
    data = read_dict(LAST_POSITION_FILE)
    return {ip: entry for ip, entry in data.items() if isinstance(entry, dict)}
