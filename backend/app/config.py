"""Filesystem locations and tunables shared by the whole backend."""

from __future__ import annotations

import os
from pathlib import Path

#: backend/
BACKEND_ROOT = Path(__file__).resolve().parent.parent

#: Where this service's STATE lives -- kept apart from its code so the service is
#: movable as one folder (LILAK SERVICE_CONTRACT §9). Standalone this is
#: ``backend/``, exactly as before. Started by the LILAK portal it is the portal's
#: own data dir for this service, handed over as PORTAL_DATA_ROOT + PORTAL_SERVICE.
#: Deriving it here rather than spelling it out in the service manifest is what
#: keeps absolute paths out of that manifest: the portal substitutes {data_root}
#: style placeholders for multi-project services only, never for a single one.
_portal_root = os.environ.get("PORTAL_DATA_ROOT")
_portal_service = os.environ.get("PORTAL_SERVICE")
STATE_ROOT = (Path(_portal_root) / _portal_service
              if _portal_root and _portal_service else BACKEND_ROOT)

#: Where profiles.json / step_names.json live.  Override with ACTUATOR_DATA_DIR.
DATA_DIR = Path(os.environ.get("ACTUATOR_DATA_DIR", STATE_ROOT / "data")).resolve()

PROFILE_FILE = DATA_DIR / "profiles.json"
STEP_NAME_FILE = DATA_DIR / "step_names.json"
#: Where each axis was last left standing, so it survives a disconnect.
LAST_POSITION_FILE = DATA_DIR / "last_positions.json"

#: Built frontend (``frontend/dist``).  Served at / when present.
STATIC_DIR = Path(
    os.environ.get("ACTUATOR_STATIC_DIR", BACKEND_ROOT.parent / "frontend" / "dist")
).resolve()

#: Append-only record of every state change, written by the logbook watcher as
#: JSON Lines -- one labelled object per line.
#: Set ACTUATOR_STATUS_LOG to "" (or "0") to turn the logbook off.
_status_log = os.environ.get("ACTUATOR_STATUS_LOG", str(DATA_DIR / "status.jsonl")).strip()
STATUS_LOG_FILE = Path(_status_log).resolve() if _status_log not in ("", "0") else None

#: Overwritten with the current state of every profile: the log says what
#: happened, this says where things stand.  Empty or "0" turns it off.
_snapshot = os.environ.get("ACTUATOR_STATUS_SNAPSHOT", str(DATA_DIR / "status.json")).strip()
STATUS_SNAPSHOT_FILE = Path(_snapshot).resolve() if _snapshot not in ("", "0") else None

#: Rotated to <name>.1 once it passes this, so it cannot fill the disk.
STATUS_LOG_MAX_BYTES = int(os.environ.get("ACTUATOR_STATUS_LOG_MAX_BYTES", 5_000_000))

#: How often the logbook compares the axes against what it last wrote.
LOG_INTERVAL = float(os.environ.get("ACTUATOR_LOG_INTERVAL", "1.0"))

#: Manuals and procedures, served read-only at /docs so the help screen can
#: link straight to them.
DOCS_DIR = Path(
    os.environ.get("ACTUATOR_DOCS_DIR", BACKEND_ROOT.parent / "docs")
).resolve()

#: How often connected-actuator status is pushed over the WebSocket.
BROADCAST_INTERVAL = float(os.environ.get("ACTUATOR_BROADCAST_INTERVAL", "0.2"))

#: Seconds of no operator command before the servo is switched off on its own.
#: Set ACTUATOR_IDLE_TIMEOUT=0 to leave axes energised indefinitely.
IDLE_TIMEOUT = float(os.environ.get("ACTUATOR_IDLE_TIMEOUT", "300"))

#: How often the idle watchdog looks at the connected axes.
IDLE_CHECK_INTERVAL = 15.0

#: Profiles offered even when they are not in profiles.json, unless hidden.
DEFAULT_PROFILES: list[dict[str, object]] = [
    {"name": "actuator_200_1", "ip": "192.168.1.200"},
    {"name": "actuator_200_2", "ip": "192.168.1.201"},
    {"name": "actuator_200_3", "ip": "192.168.1.202"},
]
