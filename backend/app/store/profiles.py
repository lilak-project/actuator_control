"""Actuator profiles: the saved name / IP / position-limit for each axis.

Deleting a profile records its IP in ``hidden_ips`` so the built-in
:data:`~app.config.DEFAULT_PROFILES` entries stay deleted too.
"""

from __future__ import annotations

import threading

from ..config import DEFAULT_PROFILES, PROFILE_FILE
from ._jsonfile import read_dict, write_dict

_lock = threading.Lock()


def _as_bool(value: object) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        return value.strip().lower() in ("1", "true", "yes", "on")
    return bool(value)


def _as_float(value: object) -> float | None:
    if value is None or value == "":
        return None
    return float(value)  # type: ignore[arg-type]


def normalize(profile: dict) -> dict | None:
    """Validate and canonicalise one profile dict, or return None if it has no IP."""
    ip = str(profile.get("ip", "")).strip()
    if not ip:
        return None

    enabled = _as_bool(profile.get("position_limit_enabled", False))
    max_position = _as_float(profile.get("max_position"))
    if enabled:
        if max_position is None:
            raise ValueError("Max position is required when the position limit is enabled")
        if max_position < 0:
            raise ValueError("Max position must be 0 or greater")

    return {
        "name": str(profile.get("name", "")).strip() or ip,
        "ip": ip,
        "position_limit_enabled": enabled,
        "max_position": max_position,
    }


def effective_limit(profile: dict) -> float | None:
    """The max position to enforce, or None when the limit is switched off."""
    if profile.get("position_limit_enabled"):
        return _as_float(profile.get("max_position"))
    return None


def load_profiles() -> list[dict]:
    """Saved profiles first, then any defaults that are neither saved nor hidden."""
    data = read_dict(PROFILE_FILE)
    hidden = set(data.get("hidden_ips") or [])
    saved = data.get("profiles")
    saved = saved if isinstance(saved, list) else []

    merged: list[dict] = []
    seen: set[str] = set()
    for entry in [*saved, *DEFAULT_PROFILES]:
        if not isinstance(entry, dict):
            continue
        try:
            profile = normalize(entry)
        except ValueError:
            continue
        if profile is None or profile["ip"] in seen or profile["ip"] in hidden:
            continue
        merged.append(profile)
        seen.add(profile["ip"])
    return merged


def save_profile(profile: dict) -> list[dict]:
    """Create or update one profile, un-hiding its IP.  Returns the new list."""
    normalized = normalize(profile)
    if normalized is None:
        raise ValueError("IP address is required")

    with _lock:
        data = read_dict(PROFILE_FILE)
        hidden = set(data.get("hidden_ips") or [])
        hidden.discard(normalized["ip"])
        entries = [item for item in (data.get("profiles") or []) if isinstance(item, dict)]

        for entry in entries:
            if str(entry.get("ip", "")).strip() == normalized["ip"]:
                entry.update(normalized)
                break
        else:
            entries.append(normalized)

        write_dict(PROFILE_FILE, {"profiles": entries, "hidden_ips": sorted(hidden)})
    return load_profiles()


def save_profile_limit(ip: str, enabled: bool, max_position: float | None) -> list[dict]:
    """Persist just the position limit of ``ip``, creating the profile if needed."""
    profile = next((item for item in load_profiles() if item["ip"] == ip), None) or {
        "name": ip,
        "ip": ip,
    }
    profile["position_limit_enabled"] = _as_bool(enabled)
    profile["max_position"] = max_position
    return save_profile(profile)


def delete_profile(ip: str) -> list[dict]:
    """Remove ``ip`` and remember it as hidden.  Returns the new list."""
    ip = str(ip).strip()
    if not ip:
        raise ValueError("IP address is required")

    with _lock:
        data = read_dict(PROFILE_FILE)
        entries = [
            item
            for item in (data.get("profiles") or [])
            if isinstance(item, dict) and str(item.get("ip", "")).strip() != ip
        ]
        hidden = set(data.get("hidden_ips") or [])
        hidden.add(ip)
        write_dict(PROFILE_FILE, {"profiles": entries, "hidden_ips": sorted(hidden)})
    return load_profiles()
