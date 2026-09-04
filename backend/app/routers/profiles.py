"""Profile CRUD.  Profiles are the saved axes the operator can connect to."""

from __future__ import annotations

from fastapi import APIRouter

from ..hardware import hub
from ..schemas import Profile
from ..store import delete_profile, load_last_positions, load_profiles, save_profile
from ..store.profiles import effective_limit
from ..store.step_names import get_step_names
from ._helpers import run_hw

router = APIRouter(prefix="/api/profiles", tags=["profiles"])
last_router = APIRouter(prefix="/api/last-positions", tags=["profiles"])


@last_router.get("")
async def last_positions() -> dict[str, dict]:
    """Where each axis was last left standing, keyed by IP.

    Recorded on every move and again when the servo is released or the session
    closed, so it is still there after a disconnect.
    """
    entries = await run_hw(load_last_positions)
    result: dict[str, dict] = {}
    for ip, entry in entries.items():
        step = entry.get("step")
        result[ip] = {
            **entry,
            "name": get_step_names(ip).get(str(step), "") if step is not None else "",
        }
    return result


@router.get("", response_model=list[Profile])
async def list_profiles() -> list[dict]:
    return await run_hw(load_profiles)


@router.put("", response_model=list[Profile])
async def upsert_profile(profile: Profile) -> list[dict]:
    """Create or update a profile; returns the full list afterwards.

    The position limit lives only on the profile, so an open session for the
    same IP is updated at the same time -- otherwise the operator would have to
    reconnect for a limit change to take effect.
    """
    profiles = await run_hw(save_profile, profile.model_dump())
    saved = next((item for item in profiles if item["ip"] == profile.ip.strip()), None)
    if saved is not None:
        try:
            actuator = hub.get(saved["ip"])
        except RuntimeError:
            return profiles  # not connected; it will pick the limit up next time
        await run_hw(
            actuator.set_position_limit,
            saved["position_limit_enabled"],
            effective_limit(saved),
        )
    return profiles


@router.delete("/{ip}", response_model=list[Profile])
async def remove_profile(ip: str) -> list[dict]:
    """Delete a profile and remember it as hidden, so defaults stay deleted."""
    return await run_hw(delete_profile, ip)
