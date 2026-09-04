"""Run blocking hardware work off the event loop, with error translation."""

from __future__ import annotations

from typing import Callable, TypeVar

from fastapi.concurrency import run_in_threadpool

from ..dependencies import as_http_error

T = TypeVar("T")


async def run_hw(fn: Callable[..., T], *args, **kwargs) -> T:
    """Await ``fn`` in a worker thread; domain errors become HTTP errors.

    Every CIP call is synchronous and can take seconds (Setup waits up to 20),
    so none of it may run on the event loop.
    """
    try:
        return await run_in_threadpool(fn, *args, **kwargs)
    except Exception as exc:  # noqa: BLE001 - re-raised as an HTTPException
        raise as_http_error(exc) from exc
