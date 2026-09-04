#!/usr/bin/env python3
"""Run the server against simulated actuators, for UI work without hardware.

    cd backend && python tools/simulator.py            # port 8080
    cd backend && python tools/simulator.py --port 8081

Every profile IP connects successfully and behaves like a real axis: Setup
homes it, Move drives toward the stored step position at a finite speed, and
BUSY/INP follow the motion. Nothing here is used by the real server -- it only
replaces the CIP driver, so the API, the manager and the UI are the real ones.
"""

from __future__ import annotations

import argparse
import random
import sys
import threading
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.hardware import jxc91 as driver  # noqa: E402

#: mm the simulated axis covers per tick, and the tick period.
_SPEED_MM_PER_TICK = 0.6
_TICK = 0.05


class SimulatedJXC91:
    """Stand-in for :class:`app.hardware.jxc91.JXC91` with the same surface."""

    def __init__(self, ip: str, poll_interval: float = driver.POLL_INTERVAL) -> None:
        self.ip = ip
        self.state = driver.InputState(ready=1, inp=1)
        self.output = driver.OutputState()
        self.connected = True

        # Deterministic per IP, so a given axis looks the same across restarts.
        # Only the first few slots are registered (mode 1); the rest are left
        # at mode 0, which is what an unused slot looks like on real hardware.
        rng = random.Random(ip)
        self._steps = {n: driver.Step() for n in range(driver.STEP_COUNT)}
        for n in range(1, 6):
            self._steps[n] = driver.Step(
                mode=1, speed=10, pos=round(rng.uniform(5, 160), 2),
                accel=100, decel=100, width=0.5,
            )

        self._position = 0.0
        self._target = 0.0
        self._stop = threading.Event()
        threading.Thread(target=self._run, name=f"sim-{ip}", daemon=True).start()

    # --- driver surface ---------------------------------------------------
    def close(self) -> None:
        self._stop.set()
        self.connected = False

    def read_input(self) -> driver.InputState:
        return self.state

    def write_output(self) -> None:
        pass

    def read_step(self, number: int) -> driver.Step:
        return self._steps[number]

    def write_step(self, number: int, step: driver.Step) -> None:
        self._steps[number] = step

    def op_setup(self) -> None:
        time.sleep(0.4)
        self.state.svre = self.state.seton = 1
        self._target = 0.0

    def op_svon(self) -> None:
        self.state.svre = 1

    def op_svoff(self) -> None:
        self.state.svre = 0

    def op_step(self, number: int) -> None:
        self._target = self._steps[number].pos

    def op_hold(self, on: bool) -> None:
        pass

    def op_reset(self) -> None:
        # Stop where we are and discard the remaining travel, then clear alarms.
        self._target = self._position
        self.state.alarms = [0, 0, 0, 0]
        self.state.alarm = 0

    # --- motion -----------------------------------------------------------
    def _run(self) -> None:
        while not self._stop.is_set():
            remaining = self._target - self._position
            if abs(remaining) > _SPEED_MM_PER_TICK:
                self._position += _SPEED_MM_PER_TICK * (1 if remaining > 0 else -1)
                self.state.busy, self.state.inp, self.state.speed = 1, 0, 30
            else:
                self._position = self._target
                self.state.busy, self.state.inp, self.state.speed = 0, 1, 0
            self.state.pos = round(self._position, 2)
            self.state.target = round(self._target, 2)
            self.state.out = 0
            self._stop.wait(_TICK)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8080)
    args = parser.parse_args()

    driver.JXC91 = SimulatedJXC91  # type: ignore[misc]
    from app.hardware import manager

    manager.JXC91 = SimulatedJXC91  # type: ignore[misc]

    import uvicorn

    from app.main import app

    print("SIMULATED actuators — no hardware is being driven", flush=True)
    print(f"UI: http://{args.host}:{args.port}", flush=True)
    uvicorn.run(app, host=args.host, port=args.port, log_level="warning")
    return 0


if __name__ == "__main__":
    sys.exit(main())
