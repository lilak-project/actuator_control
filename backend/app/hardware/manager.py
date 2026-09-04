"""Per-axis session state layered on top of the :class:`JXC91` driver.

The manager adds what the driver deliberately doesn't know about: whether the
operator has run Setup yet, the profile's position limit, and which step was
driven last.  Commands are serialised through a lock; status reads are not, so
a 20-second Setup never stalls the status broadcast.
"""

from __future__ import annotations

import threading
import time

from ..store import record_last_position
from .alarms import alarm_hint, alarm_name, recovery
from .jxc91 import STEP_COUNT, InputState, JXC91, JXC91Error, Step


class ActuatorManager:
    def __init__(self, ip: str, name: str = "", max_position: float | None = None) -> None:
        ip = str(ip).strip()
        if not ip:
            raise ValueError("IP address is required")

        self.ip = ip
        self.name = str(name or ip).strip()
        self.max_position = max_position

        self.hold = False
        self.setup_done = False
        self.last_step_number: int | None = None
        self.last_error = ""
        self.limit_violations: list[dict] = []
        self.limit_error = ""
        #: Cached scan of the whole step table -- see `scan_steps`.
        self.steps: list[dict] = []
        #: When the operator last commanded anything, for the idle watchdog.
        self.last_activity = time.monotonic()
        #: Set when the watchdog released the servo, cleared on the next command.
        self.idle_off = False

        self._lock = threading.RLock()
        self.jxc = JXC91(ip)
        try:
            self.jxc.read_input()
            self.scan_steps()
        except JXC91Error as exc:
            self.last_error = str(exc)

    # --- lifecycle --------------------------------------------------------
    def close(self, sv_off: bool = False) -> None:
        with self._lock:
            # Note where the stage is standing before letting go of it.
            self.remember_position()
            if sv_off and self.setup_done:
                try:
                    self.jxc.op_svoff()
                except Exception as exc:
                    self.last_error = str(exc)
            self.jxc.close()

    def remember_position(self, position: float | None = None) -> None:
        """Persist where the axis is (or is headed), so it outlives this session.

        Pass `position` when the axis has not arrived yet -- a move command
        returns as soon as BUSY comes up, so the live reading at that moment is
        still the starting point.
        """
        if position is None:
            position = self.jxc.state.pos
        try:
            record_last_position(self.ip, self.last_step_number, position)
        except Exception as exc:  # persistence must never break a disconnect
            self.last_error = str(exc)

    def _step_position(self, number: int) -> float | None:
        """Stored position of a slot, from the cached scan."""
        for item in self.steps:
            if item["number"] == number:
                return float(item["position"])
        return None

    # --- idle watchdog ----------------------------------------------------
    def idle_seconds(self) -> float:
        return time.monotonic() - self.last_activity

    def release_if_idle(self, timeout: float) -> bool:
        """Switch the servo off after `timeout` seconds without a command.

        Returns True if it acted. Leaving an axis energised and unattended
        holds torque on the stage for no reason; releasing it is the safe
        resting state.
        """
        if timeout <= 0 or not self.setup_done or not self.jxc.state.svre:
            return False
        if self.idle_seconds() < timeout:
            return False
        with self._lock:
            # Re-check under the lock: a command may have landed meanwhile.
            if not self.jxc.state.svre or self.idle_seconds() < timeout:
                return False
            self.remember_position()
            self.jxc.op_svoff()
            self.idle_off = True
        return True

    # --- status -----------------------------------------------------------
    def snapshot(self) -> dict:
        """Current status.  Cheap and lock-free -- safe to call at 5 Hz."""
        state: InputState = self.jxc.state
        critical = state.critical_alarms
        return {
            "ip": self.ip,
            "name": self.name,
            "connected": self.jxc.connected,
            "last_error": self.last_error,
            "hold": self.hold,
            "setup_done": self.setup_done,
            "last_step_number": self.last_step_number,
            "position_limit_enabled": self.max_position is not None,
            "max_position": self.max_position,
            "limit_violations": list(self.limit_violations),
            "limit_error": self.limit_error,
            "idle_off": self.idle_off,
            "critical_alarms": [
                {
                    "code": code,
                    "name": alarm_name(code),
                    "hint": alarm_hint(code),
                    "recovery": recovery(code),
                }
                for code in critical
            ],
            "signals": {
                "busy": bool(state.busy),
                "svre": bool(state.svre),
                "seton": bool(state.seton),
                "inp": bool(state.inp),
                "area": bool(state.area),
                "warea": bool(state.warea),
                "estop": bool(state.estop),
                "alarm": bool(state.alarm),
                "ready": bool(state.ready),
                "alarmf": bool(state.alarmf),
            },
            "out": state.out,
            "pos": state.pos,
            "speed": state.speed,
            "force": state.force,
            "target": state.target,
            "alarms": [
                {"code": code, "name": alarm_name(code)} for code in state.alarms
            ],
        }

    # --- steps ------------------------------------------------------------
    def read_step(self, number: int) -> Step:
        with self._lock:
            return self.jxc.read_step(self._valid_step(number))

    def write_step(self, number: int, step: Step) -> Step:
        self.last_activity = time.monotonic()
        number = self._valid_step(number)
        self._require_position_allowed(step.pos)
        with self._lock:
            self.jxc.write_step(number, step)
            # Re-read the whole table: it is the only way to notice edits made
            # at the controller's own teaching pendant.
            self.scan_steps()
            return self.jxc.read_step(number)

    def registered_steps(self) -> list[int]:
        """Slots holding a real step, in order. Slot 0 is the origin, not a step."""
        return sorted(
            item["number"] for item in self.steps if item["mode"] != 0 and item["number"] > 0
        )

    def delete_step(self, number: int) -> int:
        """Erase a step and close the gap so numbering stays contiguous.

        Everything above the hole moves down one slot and the top slot is
        cleared, which is a write per affected slot -- the controller has no
        notion of "remove", only "overwrite". Returns the old highest slot.
        """
        number = self._valid_step(number)
        if number == 0:
            raise ValueError("Step 0 is reserved for Init and cannot be deleted")
        with self._lock:
            registered = self.registered_steps()
            if number not in registered:
                raise ValueError(f"Step {number} is not registered")
            highest = registered[-1]

            for slot in range(number, highest):
                self.jxc.write_step(slot, self.jxc.read_step(slot + 1))
            # Mode 0 is what an unused slot looks like to the controller.
            self.jxc.write_step(highest, Step())

            if self.last_step_number is not None and self.last_step_number >= number:
                # The axis has not moved, but the number describing where it
                # stands has: either it shifted down, or it no longer exists.
                self.last_step_number = (
                    -1 if self.last_step_number == number else self.last_step_number - 1
                )
            self.scan_steps()
        return highest

    def set_position_limit(self, enabled: bool, max_position: float | None) -> None:
        """Apply a limit to this session; violations come from the cached scan."""
        if enabled:
            if max_position is None:
                raise ValueError("Max position is required when the position limit is enabled")
            if max_position < 0:
                raise ValueError("Max position must be 0 or greater")
            self.max_position = float(max_position)
        else:
            self.max_position = None
        with self._lock:
            self._recheck_limits()

    def scan_steps(self) -> list[dict]:
        """Read the whole step table into :attr:`steps`.

        Costs one CIP read per slot (~1 s), so it runs only on connect and
        after a step is written -- never on the status path. The UI plots these
        positions, and the limit check is derived from the same scan.
        """
        self.limit_error = ""
        scanned: list[dict] = []
        try:
            for number in range(STEP_COUNT):
                step = self.jxc.read_step(number)
                scanned.append({"number": number, "position": step.pos, "mode": step.mode})
            self.steps = scanned
        except Exception as exc:
            self.limit_error = str(exc)
        self._recheck_limits()
        return self.steps

    def _recheck_limits(self) -> None:
        """Derive limit violations from the cached scan."""
        if self.max_position is None:
            self.limit_violations = []
            return
        self.limit_violations = [
            {"number": item["number"], "position": item["position"], "limit": self.max_position}
            for item in self.steps
            if item["position"] > self.max_position
        ]

    # --- commands ---------------------------------------------------------
    def run_command(self, command: str, step: int | None = None, on: bool = False) -> None:
        self.last_activity = time.monotonic()
        self.idle_off = False
        with self._lock:
            if command == "setup":
                self.jxc.op_setup()
                self.setup_done = True
                return

            if command == "reset":
                # RESET is the way out of a latched alarm, and an alarm can be
                # standing before Init has ever run (099, for one), so this is
                # deliberately the one command that does not require it.
                self.jxc.op_reset()
                # Reset discards the remaining travel, so the axis is no longer
                # at a known step: -1 means "stopped somewhere in between".
                self.last_step_number = -1
                return

            self._require_setup_done()
            if command == "svon":
                self.jxc.op_svon()
            elif command == "svoff":
                self.remember_position()
                self.jxc.op_svoff()
                # last_step_number is deliberately kept: the operator still
                # wants to see which step the axis is parked at.
            elif command == "hold":
                self.jxc.op_hold(on)
                self.hold = on
            elif command == "move":
                self._require_moves_allowed()
                number = self._valid_step(step or 0)
                self.jxc.op_step(number)
                self.last_step_number = number
                # The axis is still travelling; record where it is going. The
                # settled value is written again on release or disconnect.
                self.remember_position(self._step_position(number))
            else:
                raise ValueError(f"Unknown command: {command}")

    # --- guards -----------------------------------------------------------
    @staticmethod
    def _valid_step(number: int | None) -> int:
        number = int(number or 0)
        if not 0 <= number < STEP_COUNT:
            raise ValueError(f"Step number must be between 0 and {STEP_COUNT - 1}")
        return number

    def _require_setup_done(self) -> None:
        if not self.setup_done:
            raise RuntimeError("Run Setup first")

    def _require_position_allowed(self, position: float) -> None:
        if self.max_position is not None and float(position) > self.max_position:
            raise ValueError(
                f"Position {float(position):.2f} mm is over the profile limit "
                f"{self.max_position:.2f} mm"
            )

    def _require_moves_allowed(self) -> None:
        self._recheck_limits()
        if self.limit_error:
            raise RuntimeError(f"Move blocked: position limit check failed ({self.limit_error})")
        if self.limit_violations:
            raise RuntimeError(
                f"Move blocked: {len(self.limit_violations)} step(s) are above the profile limit"
            )
