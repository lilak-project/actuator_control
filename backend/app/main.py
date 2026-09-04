"""JXC91 actuator control service.

Serves a JSON API plus a WebSocket status stream, and (once the frontend is
built) the single-page UI from the same origin and port.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
from collections.abc import AsyncIterator

from fastapi import FastAPI
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from starlette.responses import Response
from starlette.types import Scope

from .config import (
    DOCS_DIR,
    IDLE_CHECK_INTERVAL,
    IDLE_TIMEOUT,
    LOG_INTERVAL,
    STATIC_DIR,
)
from .hardware import hub
from .logbook import logbook
from .store import snapshot, status_log
from .routers import actuators, legacy, profiles, reference, report, status

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("actuator")

# pycomm3 logs every CIP request and reply at INFO. The driver polls each axis
# four times a second, so at INFO that is a solid wall of "Sending generic
# message: input" and nothing else is readable. Failures still come through.
logging.getLogger("pycomm3").setLevel(logging.WARNING)


class _QuietPolling(logging.Filter):
    """Keep status polling out of the access log, as the previous server did.

    Without this a single stale browser writes several lines a second and
    buries everything worth reading.
    """

    QUIET_PATHS = ("/api/status",)

    def filter(self, record: logging.LogRecord) -> bool:
        args = record.args
        if isinstance(args, tuple) and len(args) >= 3:
            path = str(args[2])
            return not path.startswith(self.QUIET_PATHS)
        return True


logging.getLogger("uvicorn.access").addFilter(_QuietPolling())


async def _idle_watchdog() -> None:
    """Release axes left energised and unattended.

    Holding torque on a stage nobody is driving wears the motor and leaves a
    live axis on the beamline; the resting state should be servo off.
    """
    while True:
        await asyncio.sleep(IDLE_CHECK_INTERVAL)
        try:
            released = await run_in_threadpool(hub.release_idle, IDLE_TIMEOUT)
        except Exception:
            log.exception("idle watchdog failed")
            continue
        for ip in released:
            log.info("%s: servo released after %.0f s idle", ip, IDLE_TIMEOUT)


async def _logbook_watcher() -> None:
    """Append a line to the status log whenever an axis changes.

    Runs off the same reduced state the report endpoint serves, so what is
    logged and what is shown can never drift apart.
    """
    while True:
        await asyncio.sleep(LOG_INTERVAL)
        try:
            await run_in_threadpool(logbook.record_changes)
        except Exception:
            log.exception("logbook watcher failed")


@contextlib.asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    await status.broadcaster.start()
    watchdog = asyncio.create_task(_idle_watchdog(), name="idle-watchdog") if IDLE_TIMEOUT > 0 else None
    if watchdog is None:
        log.info("idle servo release is disabled (ACTUATOR_IDLE_TIMEOUT=0)")

    if status_log.enabled() or snapshot.enabled():
        scribe = asyncio.create_task(_logbook_watcher(), name="logbook")
        log.info(
            "status files: log=%s snapshot=%s",
            status_log.path() or "(off)",
            snapshot.path() or "(off)",
        )
    else:
        scribe = None
        log.info("status log and snapshot are both disabled")

    try:
        yield
    finally:
        for task in (watchdog, scribe):
            if task is None:
                continue
            task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await task
        await status.broadcaster.stop()
        # Leaving axes energised after the server stops would be a surprise.
        hub.disconnect_all()
        # The watcher is already cancelled, so close the log by hand -- a shift
        # that ends with the server going down should say so.
        with contextlib.suppress(Exception):
            logbook.record_changes()


app = FastAPI(
    title="JXC91 Actuator Control",
    description="Control and monitoring for SMC JXC91 electric actuators over EtherNet/IP.",
    version="2.0.0",
    lifespan=lifespan,
)

# The Vite dev server runs on another port; in production the UI is same-origin
# and these headers are simply unused. Covers the private ranges this host is
# actually on: the lab LANs, the actuator subnet, and the VPN overlay.
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=(
        r"http://(localhost|127\.0\.0\.1"
        r"|10\.\d+\.\d+\.\d+"
        r"|192\.168\.\d+\.\d+"
        r"|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)(:\d+)?"
    ),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(profiles.router)
app.include_router(profiles.last_router)
app.include_router(actuators.router)
app.include_router(status.router)
app.include_router(reference.router)
app.include_router(report.router)
app.include_router(legacy.router)


@app.get("/api/health", tags=["meta"])
async def health() -> dict:
    return {"ok": True, "connected": sorted(hub.connected_ips())}


class UiFiles(StaticFiles):
    """Serve the built UI, revalidating the entry point on every load.

    Vite fingerprints the asset filenames, so those can be cached hard. The
    HTML that points at them must not be, or a browser keeps running the
    previous build after a redeploy and calls endpoints that no longer exist.
    """

    async def get_response(self, path: str, scope: Scope) -> Response:
        response = await super().get_response(path, scope)
        if path.endswith(".html") or path in ("", "."):
            response.headers["Cache-Control"] = "no-cache, must-revalidate"
        elif response.status_code == 200 and "/assets/" in scope.get("path", ""):
            response.headers["Cache-Control"] = "public, max-age=31536000, immutable"
        return response


if DOCS_DIR.is_dir():
    # Mounted before the UI so the help screen can link to the manuals; nothing
    # here is writable and none of it is secret.
    app.mount("/docs", StaticFiles(directory=DOCS_DIR, html=True), name="docs")

if STATIC_DIR.is_dir():
    # Mounted last so it never shadows /api or /ws.
    app.mount("/", UiFiles(directory=STATIC_DIR, html=True), name="ui")
else:
    log.warning("Frontend build not found at %s - run `npm run build` in frontend/", STATIC_DIR)

    @app.get("/", tags=["meta"])
    async def missing_ui() -> dict:
        return {
            "ok": False,
            "error": "Frontend is not built.",
            "hint": "cd frontend && npm install && npm run build",
            "api_docs": "/docs",
        }
