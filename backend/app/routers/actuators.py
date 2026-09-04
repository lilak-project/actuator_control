"""Connect/disconnect axes and drive the ones that are connected."""

from __future__ import annotations

from fastapi import APIRouter, Depends, status

from ..hardware import ActuatorManager, Step, hub
from ..dependencies import get_actuator
from ..schemas import (
    CommandRequest,
    ConnectRequest,
    SaveStepRequest,
    StepNameRequest,
    StepResponse,
)
from ..store import delete_step_name, get_step_names, load_profiles, save_step_name
from ..store.profiles import effective_limit
from ._helpers import run_hw

router = APIRouter(prefix="/api/actuators", tags=["actuators"])

#: Values forced in "limited edit" mode: a plain absolute move at a safe speed.
LIMITED_PRESET = {"mode": 1, "speed": 5}


@router.get("")
async def list_actuators() -> list[dict]:
    """Status of every connected actuator (same shape the WebSocket pushes)."""
    return hub.snapshots()


@router.post("", status_code=status.HTTP_201_CREATED)
async def connect(request: ConnectRequest) -> dict:
    """Open a session, applying the position limit stored in the profile."""
    profile = next((item for item in load_profiles() if item["ip"] == request.ip), None)
    max_position = effective_limit(profile) if profile else None
    name = request.name or (profile["name"] if profile else request.ip)
    return await run_hw(hub.connect, request.ip, name, max_position)


@router.delete("/{ip}", status_code=status.HTTP_204_NO_CONTENT)
async def disconnect(ip: str, sv_off: bool = False) -> None:
    """Close the session, optionally switching the servo off on the way out."""
    await run_hw(hub.disconnect, ip, sv_off)


@router.get("/{ip}")
async def get_status(actuator: ActuatorManager = Depends(get_actuator)) -> dict:
    return actuator.snapshot()


@router.post("/{ip}/command")
async def run_command(
    request: CommandRequest,
    actuator: ActuatorManager = Depends(get_actuator),
) -> dict:
    await run_hw(actuator.run_command, request.command, request.step, request.on)
    await run_hw(actuator.jxc.read_input)
    return actuator.snapshot()


# --- step table -----------------------------------------------------------
@router.get("/{ip}/steps/{number}", response_model=StepResponse)
async def read_step(
    number: int,
    actuator: ActuatorManager = Depends(get_actuator),
) -> dict:
    step = await run_hw(actuator.read_step, number)
    return _step_response(actuator.ip, number, step)


@router.put("/{ip}/steps/{number}", response_model=StepResponse)
async def write_step(
    number: int,
    request: SaveStepRequest,
    actuator: ActuatorManager = Depends(get_actuator),
) -> dict:
    if request.limited:
        existing = await run_hw(actuator.read_step, number)
        step = Step(**{**vars(existing), **LIMITED_PRESET, "pos": request.step.pos})
    else:
        step = Step(**request.step.model_dump())

    saved = await run_hw(actuator.write_step, number, step)
    return _step_response(actuator.ip, number, saved)


@router.get("/{ip}/steps")
async def read_steps(actuator: ActuatorManager = Depends(get_actuator)) -> list[dict]:
    """Every stored step position, from the cached scan.

    Served from cache, not the wire: a fresh scan is 64 CIP reads. The cache is
    refreshed on connect and after any step write.
    """
    return _steps_response(actuator)


@router.delete("/{ip}/steps/{number}", response_model=list[dict])
async def delete_step(
    number: int,
    actuator: ActuatorManager = Depends(get_actuator),
) -> list[dict]:
    """Remove a step and pull the ones above it down to close the gap."""
    highest = await run_hw(actuator.delete_step, number)
    await run_hw(delete_step_name, actuator.ip, number, highest)
    return _steps_response(actuator)


@router.get("/{ip}/step-names")
async def read_step_names(actuator: ActuatorManager = Depends(get_actuator)) -> dict[str, str]:
    return get_step_names(actuator.ip)


@router.put("/{ip}/step-names/{number}")
async def write_step_name(
    number: int,
    request: StepNameRequest,
    actuator: ActuatorManager = Depends(get_actuator),
) -> dict[str, str]:
    return await run_hw(save_step_name, actuator.ip, number, request.name)


def _steps_response(actuator: ActuatorManager) -> list[dict]:
    names = get_step_names(actuator.ip)
    return [{**item, "name": names.get(str(item["number"]), "")} for item in actuator.steps]


def _step_response(ip: str, number: int, step: Step) -> dict:
    return {**vars(step), "number": number, "name": get_step_names(ip).get(str(number), "")}
