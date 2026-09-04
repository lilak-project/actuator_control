"""Shared FastAPI dependencies and exception translation."""

from __future__ import annotations

from fastapi import HTTPException, Path, status

from .hardware import ActuatorManager, JXC91Error, hub


def get_actuator(ip: str = Path(..., description="Actuator IP address")) -> ActuatorManager:
    """Resolve a connected actuator, or fail with 404."""
    try:
        return hub.get(ip)
    except RuntimeError as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(exc)) from exc


def as_http_error(exc: Exception) -> HTTPException:
    """Map a domain error onto the status code the UI should see."""
    if isinstance(exc, ValueError):
        return HTTPException(status.HTTP_400_BAD_REQUEST, str(exc))
    if isinstance(exc, JXC91Error):
        return HTTPException(status.HTTP_502_BAD_GATEWAY, str(exc))
    if isinstance(exc, RuntimeError):
        return HTTPException(status.HTTP_409_CONFLICT, str(exc))
    return HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, str(exc))
