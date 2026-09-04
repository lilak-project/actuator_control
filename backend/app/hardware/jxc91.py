"""SMC JXC91 (EtherNet/IP) controller driver.

Thin, synchronous wrapper around :mod:`pycomm3`'s ``CIPDriver``.  All CIP
object addresses and the bit/word layout below come from the JXC91 manual and
must not be changed casually -- they are what the controller actually expects.

A background thread refreshes the input map every ``POLL_INTERVAL`` seconds so
that reading status never costs a network round trip.
"""

from __future__ import annotations

import threading
import time
from dataclasses import dataclass, field
from struct import pack
from typing import Callable

from pycomm3 import CIPDriver, UINT

from .alarms import CRITICAL_CODES

#: How often the background thread re-reads the controller input map.
POLL_INTERVAL = 0.25

#: Number of step-data slots in a JXC91.
STEP_COUNT = 64

# --- CIP addressing -------------------------------------------------------
_SERVICE_GET = b"\x0E"
_SERVICE_SET = b"\x10"
_CLASS_STEP = b"\x67"
_CLASS_IO = b"\x04"
_ATTR_STEP = 100
_INSTANCE_INPUT = 100
_INSTANCE_OUTPUT = 150
_ATTR_IO = 3


def _split_i32(value: float) -> tuple[int, int]:
    """Encode ``value`` mm as the low/high 16-bit words of a 0.01 mm integer.

    Negative values are two's complement across the pair (manual §17 (3)), so
    they are masked into 32 bits rather than handed to ``pack`` as negatives.
    """
    raw = int(value * 100) & 0xFFFFFFFF
    return raw & 0xFFFF, raw >> 16


def _join_i32(low: int, high: int) -> float:
    """Decode a low/high 16-bit word pair into millimetres, sign included."""
    raw = low + high * 65536
    if raw >= 0x80000000:
        raw -= 0x100000000
    return raw * 0.01


@dataclass
class Step:
    """One entry of the controller's step table."""

    mode: int = 0  # 0 disable, 1 absolute, 2 relative
    speed: int = 0  # mm/s
    pos: float = 0.0  # mm
    accel: int = 1  # mm/s^2
    decel: int = 1  # mm/s^2
    push: int = 0  # 0 positioning, 1..100 pushing (%)
    trig: int = 0  # INP turns on above this pushing force (%)
    p_speed: int = 0  # pushing speed, mm/s
    m_force: int = 0  # moving force (%)
    area1: float = 0.0  # mm
    area2: float = 0.0  # mm; area1 < pos < area2 turns AREA on
    width: float = 0.0  # positioning range, or pushing distance

    @classmethod
    def decode(cls, words: list[int]) -> "Step":
        """Build a step from the 16 UINT words returned by the controller."""
        return cls(
            mode=words[0],
            speed=words[1],
            pos=_join_i32(words[2], words[3]),
            accel=words[4],
            decel=words[5],
            push=words[6],
            trig=words[7],
            p_speed=words[8],
            m_force=words[9],
            area1=_join_i32(words[10], words[11]),
            area2=_join_i32(words[12], words[13]),
            width=_join_i32(words[14], words[15]),
        )

    def encode(self) -> bytes:
        """Serialise to the 16 little-endian UINT words the controller writes."""
        return pack(
            "<16H",
            self.mode,
            self.speed,
            *_split_i32(self.pos),
            self.accel,
            self.decel,
            self.push,
            self.trig,
            self.p_speed,
            self.m_force,
            *_split_i32(self.area1),
            *_split_i32(self.area2),
            *_split_i32(self.width),
        )


@dataclass
class InputState:
    """Decoded controller input map -- what the axis is currently doing."""

    out: int = 0  # active step number, 0..63
    busy: int = 0
    svre: int = 0  # servo ready
    seton: int = 0  # origin established
    inp: int = 0  # in position
    area: int = 0
    warea: int = 0
    estop: int = 0
    alarm: int = 0
    ready: int = 0
    alarmf: int = 0
    pos: float = 0.0  # mm
    speed: float = 0.0  # mm/s
    force: float = 0.0  # %
    target: float = 0.0  # mm
    alarms: list[int] = field(default_factory=lambda: [0, 0, 0, 0])

    @classmethod
    def decode(cls, words: list[int]) -> "InputState":
        return cls(
            out=words[0] & 0x3F,
            busy=(words[0] >> 8) & 0x1,
            svre=(words[0] >> 9) & 0x1,
            seton=(words[0] >> 10) & 0x1,
            inp=(words[0] >> 11) & 0x1,
            area=(words[0] >> 12) & 0x1,
            warea=(words[0] >> 13) & 0x1,
            estop=(words[0] >> 14) & 0x1,
            alarm=(words[0] >> 15) & 0x1,
            ready=(words[1] >> 4) & 0x1,
            alarmf=(words[1] >> 5) & 0x1,
            pos=_join_i32(words[2], words[3]),
            speed=words[4],
            force=words[5],
            target=_join_i32(words[6], words[7]),
            alarms=[
                words[8] & 0xFF,
                (words[8] >> 8) & 0xFF,
                words[9] & 0xFF,
                (words[9] >> 8) & 0xFF,
            ],
        )

    @property
    def critical_alarms(self) -> list[int]:
        return [code for code in self.alarms if code in CRITICAL_CODES]


@dataclass
class OutputState:
    """Controller output map -- the signals we drive."""

    inn: int = 0  # step number to run, 0..63
    hold: int = 0
    svon: int = 0
    drive: int = 0
    reset: int = 0
    setup: int = 0
    jogn: int = 0
    jogp: int = 0
    flgth: int = 0

    def encode(self) -> bytes:
        flags = (
            (self.hold & 0x1)
            | ((self.svon & 0x1) << 1)
            | ((self.drive & 0x1) << 2)
            | ((self.reset & 0x1) << 3)
            | ((self.setup & 0x1) << 4)
            | ((self.jogn & 0x1) << 5)
            | ((self.jogp & 0x1) << 6)
            | ((self.flgth & 0x1) << 7)
        )
        # 2 command bytes followed by 17 unused words of numerical control data.
        return pack("<2B17H", self.inn, flags, *([0] * 17))


class JXC91Error(RuntimeError):
    """Raised when the controller rejects or fails to answer a request."""


class JXC91:
    """Connection to a single JXC91 axis.

    The instance owns a daemon thread that keeps :attr:`state` fresh, so
    callers can read status without touching the network.
    """

    def __init__(self, ip: str, poll_interval: float = POLL_INTERVAL) -> None:
        self.ip = ip
        self.state = InputState()
        self.output = OutputState()

        self._io_lock = threading.RLock()
        self._stop = threading.Event()
        self._driver = CIPDriver(ip)
        # CIPDriver opens lazily; close first so a failed open surfaces here.
        self._driver.close()
        self.open()

        self._poller = threading.Thread(
            target=self._poll_loop,
            args=(poll_interval,),
            name=f"jxc91-poll-{ip}",
            daemon=True,
        )
        self._poller.start()

    # --- connection -------------------------------------------------------
    def open(self) -> bool:
        with self._io_lock:
            return self._driver.open()

    def close(self) -> None:
        self._stop.set()
        with self._io_lock:
            self._driver.close()

    @property
    def connected(self) -> bool:
        return bool(self._driver.connected)

    def __del__(self) -> None:  # pragma: no cover - best effort cleanup
        try:
            self.close()
        except Exception:
            pass

    # --- raw I/O ----------------------------------------------------------
    def read_input(self) -> InputState:
        """Read and cache the controller input map."""
        with self._io_lock:
            tag = self._driver.generic_message(
                service=_SERVICE_GET,
                class_code=_CLASS_IO,
                instance=_INSTANCE_INPUT,
                attribute=_ATTR_IO,
                data_type=UINT[18],
                name="input",
                connected=False,
            )
        if tag.error:
            raise JXC91Error(f"Cannot read input map: {tag.error}")
        self.state = InputState.decode(tag.value)
        return self.state

    def write_output(self) -> None:
        """Push :attr:`output` to the controller."""
        with self._io_lock:
            tag = self._driver.generic_message(
                service=_SERVICE_SET,
                class_code=_CLASS_IO,
                instance=_INSTANCE_OUTPUT,
                attribute=_ATTR_IO,
                request_data=self.output.encode(),
                name="output",
            )
        if tag.error:
            raise JXC91Error(f"Cannot write output map: {tag.error}")

    def read_step(self, number: int) -> Step:
        with self._io_lock:
            tag = self._driver.generic_message(
                service=_SERVICE_GET,
                class_code=_CLASS_STEP,
                instance=number + 1,
                attribute=_ATTR_STEP,
                data_type=UINT[16],
                name="step",
                connected=False,
            )
        if tag.error:
            raise JXC91Error(f"Cannot read step {number}: {tag.error}")
        return Step.decode(tag.value)

    def write_step(self, number: int, step: Step) -> None:
        self._require_no_critical_alarm()
        with self._io_lock:
            tag = self._driver.generic_message(
                service=_SERVICE_SET,
                class_code=_CLASS_STEP,
                instance=number + 1,
                attribute=_ATTR_STEP,
                request_data=step.encode(),
                name="step",
            )
        if tag.error:
            raise JXC91Error(f"Cannot write step {number}: {tag.error}")

    # --- operations -------------------------------------------------------
    def op_setup(self) -> None:
        """Return to origin and establish the coordinate system."""
        self._require_no_critical_alarm()
        self._reset_output()
        self.output.svon = 1
        self.write_output()
        if not self._wait_for(lambda: self.state.svre):
            raise JXC91Error("Servo did not become ready (SVRE stayed off)")

        self.output.setup = 1
        self.write_output()
        try:
            if not self._wait_for(lambda: self.state.busy or self.state.seton, timeout=20.0):
                raise JXC91Error("Return to origin did not start within 20 s")
        finally:
            self.output.setup = 0
            self.write_output()

    def op_svon(self) -> None:
        self._require_no_critical_alarm()
        self._reset_output()
        self.output.svon = 1
        self.write_output()
        if not self._wait_for(lambda: self.state.svre):
            raise JXC91Error("Servo did not turn on (SVRE stayed off)")

    def op_svoff(self) -> None:
        self._reset_output()
        self.output.svon = 0
        self.write_output()
        if not self._wait_for(lambda: not self.state.svre):
            raise JXC91Error("Servo did not turn off (SVRE stayed on)")

    def op_step(self, number: int) -> None:
        """Drive to the position stored in step ``number``."""
        self._require_no_critical_alarm()
        state = self.state
        if state.alarm:
            raise JXC91Error("Cannot move: controller is in alarm")
        if not state.ready:
            raise JXC91Error("Cannot move: controller is not READY")
        if not state.svre:
            raise JXC91Error("Cannot move: servo is off")
        if state.busy:
            raise JXC91Error("Cannot move: controller is busy")

        self.output.svon = 1
        self.output.inn = number
        self.write_output()
        time.sleep(0.05)  # let the step number settle before asserting DRIVE

        self.output.drive = 1
        self.write_output()
        try:
            if not self._wait_for(lambda: self.state.busy or self.state.inp, timeout=10.0):
                raise JXC91Error(f"Step {number} did not start within 10 s")
        finally:
            self.output.drive = 0
            self.write_output()

    def op_hold(self, on: bool) -> None:
        if on:
            self._require_no_critical_alarm()
        self.output.hold = 1 if on else 0
        self.write_output()

    def op_reset(self) -> None:
        """Pulse RESET, which both stops motion and clears resettable alarms."""
        self.output.reset = 1
        self.write_output()
        time.sleep(0.1)
        self.output.reset = 0
        self.write_output()

    # --- internals --------------------------------------------------------
    def _reset_output(self) -> None:
        self.output = OutputState()

    def _require_no_critical_alarm(self) -> None:
        """Refresh state and refuse to command a faulted axis."""
        state = self.read_input()
        critical = state.critical_alarms
        if critical:
            raise JXC91Error(
                "Command blocked by critical alarm: "
                + ", ".join(str(code) for code in critical)
            )

    def _wait_for(self, condition: Callable[[], bool], timeout: float = 5.0) -> bool:
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            time.sleep(0.05)
            if condition():
                return True
        return False

    def _poll_loop(self, interval: float) -> None:
        while not self._stop.is_set():
            if self.connected:
                try:
                    self.read_input()
                except Exception:
                    # A transient read failure is reported through `connected`
                    # on the next status snapshot; keep the loop alive.
                    pass
            self._stop.wait(interval)
