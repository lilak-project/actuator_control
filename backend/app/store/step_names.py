"""Human-readable labels for step slots, keyed by actuator IP then step number."""

from __future__ import annotations

import threading

from ..config import STEP_NAME_FILE
from ._jsonfile import read_dict, write_dict

_lock = threading.Lock()


def get_step_names(ip: str) -> dict[str, str]:
    names = read_dict(STEP_NAME_FILE).get(str(ip).strip(), {})
    return {str(k): str(v) for k, v in names.items()} if isinstance(names, dict) else {}


def delete_and_compact(ip: str, number: int, highest: int) -> dict[str, str]:
    """Drop the label for `number` and pull the ones above it down one slot.

    Mirrors the same shuffle in the step table, so a label never ends up
    describing a different position than the one it was written for.
    """
    ip = str(ip).strip()
    with _lock:
        data = read_dict(STEP_NAME_FILE)
        names = data.get(ip)
        if not isinstance(names, dict):
            return {}
        shifted: dict[str, str] = {}
        for key, value in names.items():
            try:
                slot = int(key)
            except (TypeError, ValueError):
                continue
            if slot == number:
                continue
            shifted[str(slot - 1 if number < slot <= highest else slot)] = str(value)
        data[ip] = shifted
        write_dict(STEP_NAME_FILE, data)
    return get_step_names(ip)


def save_step_name(ip: str, number: int, name: str) -> dict[str, str]:
    """Set or (when ``name`` is blank) clear one label.  Returns all labels for ``ip``."""
    ip = str(ip).strip()
    if not ip:
        raise ValueError("IP address is required")
    key = str(int(number))
    name = str(name).strip()

    with _lock:
        data = read_dict(STEP_NAME_FILE)
        names = data.setdefault(ip, {})
        if not isinstance(names, dict):
            names = {}
            data[ip] = names
        if name:
            names[key] = name
        else:
            names.pop(key, None)
        write_dict(STEP_NAME_FILE, data)
    return get_step_names(ip)
