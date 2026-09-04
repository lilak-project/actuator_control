"""A point-in-time status line for every saved actuator.

One row per profile whether or not it is connected: as JSON for tooling, and in
fixed columns for pasting into a logbook or appending to a file --

    curl -s http://<host>:8080/api/report.txt >> ~/beamline.log

The same rows drive the logbook, which writes a line whenever one of them
changes.
"""

from __future__ import annotations

from datetime import datetime, timezone

from .hardware import hub
from .store import load_last_positions, load_profiles
from .store.step_names import get_step_names

#: Slot 0 is the reserved Init entry; its label never comes from the store.
ORIGIN_STEP = 0
ORIGIN_NAME = "Init"


def _step_name(ip: str, step: int | None) -> str:
    if step is None or step < 0:
        return ""
    if step == ORIGIN_STEP:
        return ORIGIN_NAME
    return get_step_names(ip).get(str(step), "")


def build_report() -> dict:
    """One row per profile, from the live session where there is one."""
    snapshots = {item["ip"]: item for item in hub.snapshots()}
    last = load_last_positions()

    rows = []
    for profile in load_profiles():
        ip = profile["ip"]
        live = snapshots.get(ip)
        entry = last.get(ip, {})

        if live is not None:
            step = live["last_step_number"]
            row = {
                "name": profile["name"],
                "ip": ip,
                "connected": True,
                "servo_on": bool(live["signals"]["svre"]),
                "homed": bool(live["setup_done"]),
                "moving": bool(live["signals"]["busy"]),
                # Stop abandons a move part-way, so the axis is between steps
                # and the operator has to choose one again.
                "stopped": step == -1,
                "step": None if step is None or step < 0 else step,
                "step_name": _step_name(ip, step),
                "position_mm": live["pos"],
                "alarms": [alarm["code"] for alarm in live["alarms"] if alarm["code"]],
                "seen_at": None,
            }
        else:
            step = entry.get("step")
            row = {
                "name": profile["name"],
                "ip": ip,
                "connected": False,
                "servo_on": None,
                "homed": False,
                "moving": False,
                "stopped": step == -1,
                "step": None if step is None or step < 0 else step,
                "step_name": _step_name(ip, step),
                "position_mm": entry.get("position"),
                "alarms": [],
                # When the reading was taken, since nothing is watching it now.
                "seen_at": entry.get("at"),
            }
        rows.append(row)

    return {
        "at": datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds"),
        "actuators": rows,
    }


def _seen_cell(row: dict) -> str:
    """When an offline row's reading was taken -- it is history, not status."""
    if row["connected"] or not row["seen_at"]:
        return "-"
    try:
        return datetime.fromisoformat(row["seen_at"]).strftime("%Y-%m-%d %H:%M")
    except ValueError:
        return str(row["seen_at"])


def step_cell(row: dict) -> str:
    """The Step column, shared by the report and the log view."""
    if row.get("stopped"):
        return "stopped"
    if row.get("step") is None:
        return "-"
    name = row.get("step_name") or ""
    return f"{row['step']} · {name}" if name else str(row["step"])


def format_report(report: dict) -> str:
    """Fixed columns, so a week of these still lines up in a log file."""
    header = ("Actuator", "IP", "Conn", "Servo", "Step", "Position", "Alarm", "Seen")
    cells = [
        (
            row["name"],
            row["ip"],
            "o" if row["connected"] else "x",
            "-" if row["servo_on"] is None else ("on" if row["servo_on"] else "off"),
            step_cell(row),
            "-" if row["position_mm"] is None else f"{row['position_mm']:.2f} mm",
            ", ".join(str(code) for code in row["alarms"]) or "-",
            _seen_cell(row),
        )
        for row in report["actuators"]
    ]

    widths = [
        max(len(header[i]), *(len(cell[i]) for cell in cells)) if cells else len(header[i])
        for i in range(len(header))
    ]

    def line(values: tuple[str, ...]) -> str:
        # The last column is not padded, so nothing carries trailing spaces.
        return "  ".join(
            value.ljust(widths[i]) if i < len(values) - 1 else value
            for i, value in enumerate(values)
        ).rstrip()

    out = [f"Actuator status  {report['at']}", "", line(header)]
    out += [line(cell) for cell in cells]
    if not cells:
        out.append("(no profiles)")
    return "\n".join(out) + "\n"


def format_log(records: list[dict]) -> str:
    """Render logged records as a table, for reading rather than parsing.

    The file itself is JSON Lines; this is the view, so the columns are sized to
    whatever was asked for instead of being fixed for all time.
    """
    header = ("Time", "Event", "Actuator", "Conn", "Servo", "Step", "Position", "Alarm")
    cells = [
        (
            str(record.get("at", "")),
            ", ".join(record.get("events") or []),
            str(record.get("actuator", "")),
            "o" if record.get("connected") else "x",
            "-" if record.get("servo_on") is None else ("on" if record["servo_on"] else "off"),
            step_cell(record),
            "-"
            if record.get("position_mm") is None
            else f"{float(record['position_mm']):.2f} mm",
            ", ".join(str(code) for code in record.get("alarms") or []) or "-",
        )
        for record in records
    ]
    if not cells:
        return "Nothing logged yet.\n"

    widths = [
        max(len(header[i]), *(len(cell[i]) for cell in cells)) for i in range(len(header))
    ]

    def line(values: tuple[str, ...]) -> str:
        return "  ".join(
            value.ljust(widths[i]) if i < len(values) - 1 else value
            for i, value in enumerate(values)
        ).rstrip()

    return "\n".join([line(header)] + [line(cell) for cell in cells]) + "\n"
