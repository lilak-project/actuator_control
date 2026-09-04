"""Request and response models for the HTTP + WebSocket API."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

from .hardware import STEP_COUNT

Command = Literal["setup", "svon", "svoff", "reset", "hold", "move"]


class Profile(BaseModel):
    name: str = ""
    ip: str
    position_limit_enabled: bool = False
    max_position: float | None = None


class ProfileDelete(BaseModel):
    ip: str


class ConnectRequest(BaseModel):
    ip: str
    name: str = ""


class CommandRequest(BaseModel):
    command: Command
    step: int | None = Field(default=None, ge=0, lt=STEP_COUNT)
    on: bool = False


class StepData(BaseModel):
    """One step-table entry.  Bounds mirror what the JXC91 accepts."""

    mode: int = Field(default=1, ge=0, le=2)
    speed: int = Field(default=5, ge=0, le=999)
    pos: float = Field(default=0.0, ge=0, le=999)
    accel: int = Field(default=1, ge=0, le=9999)
    decel: int = Field(default=1, ge=0, le=9999)
    push: int = Field(default=0, ge=0, le=100)
    trig: int = Field(default=0, ge=0, le=100)
    p_speed: int = Field(default=0, ge=0, le=100)
    m_force: int = Field(default=0, ge=0, le=100)
    area1: float = Field(default=0.0, ge=0, le=999)
    area2: float = Field(default=0.0, ge=0, le=999)
    width: float = Field(default=0.0, ge=0, le=999)


class StepResponse(StepData):
    number: int
    name: str = ""


class SaveStepRequest(BaseModel):
    step: StepData
    #: When true only `pos` is taken from `step`; mode/speed are forced to the
    #: safe absolute-move preset and every other field keeps its stored value.
    limited: bool = True


class StepNameRequest(BaseModel):
    name: str = ""
