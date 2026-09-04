#!/usr/bin/env python3
"""Rewrite the speed of every registered step on one or more actuators.

Step data lives on the controller, so this talks to the hardware directly.
It previews by default; nothing is written until you pass --apply.

    cd backend
    python tools/set_step_speed.py --speed 5                 # preview all axes
    python tools/set_step_speed.py --speed 5 --apply         # write them
    python tools/set_step_speed.py --speed 5 --ip 192.168.1.153 --apply

Stop the control server first: two clients writing the same step table at once
is not something the controller arbitrates for you.
"""

from __future__ import annotations

import argparse
import sys
from dataclasses import replace
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.hardware.jxc91 import STEP_COUNT, JXC91  # noqa: E402
from app.store import load_profiles  # noqa: E402


def plan(driver, speed: int) -> list[tuple[int, int]]:
    """Registered steps whose speed differs, as (slot, current speed)."""
    changes = []
    for number in range(1, STEP_COUNT):
        step = driver.read_step(number)
        # Mode 0 is an unregistered slot: leave it alone.
        if step.mode != 0 and step.speed != speed:
            changes.append((number, step.speed))
    return changes


def retune(driver, speed: int, apply: bool) -> list[tuple[int, int]]:
    changes = plan(driver, speed)
    if apply:
        for number, _ in changes:
            driver.write_step(number, replace(driver.read_step(number), speed=speed))
    return changes


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--speed", type=int, required=True, help="new speed in mm/s")
    parser.add_argument(
        "--ip",
        action="append",
        dest="ips",
        help="actuator to change; repeatable. Default: every saved profile.",
    )
    parser.add_argument("--apply", action="store_true", help="actually write (default: preview)")
    args = parser.parse_args()

    if not 0 <= args.speed <= 999:
        print("speed must be between 0 and 999 mm/s", file=sys.stderr)
        return 2

    targets = args.ips or [profile["ip"] for profile in load_profiles()]
    if not targets:
        print("No actuators to work on.", file=sys.stderr)
        return 1

    if not args.apply:
        print("PREVIEW — nothing will be written. Add --apply to commit.\n")

    failures = 0
    for ip in targets:
        print(f"{ip}")
        try:
            driver = JXC91(ip)
        except Exception as exc:
            print(f"  cannot connect: {exc}\n")
            failures += 1
            continue
        try:
            changes = retune(driver, args.speed, args.apply)
            if not changes:
                print(f"  every registered step is already {args.speed} mm/s\n")
                continue
            verb = "set" if args.apply else "would set"
            for number, was in changes:
                print(f"  step {number:2}: {was:3} -> {args.speed:3} mm/s  ({verb})")
            print()
        except Exception as exc:
            print(f"  failed: {exc}\n")
            failures += 1
        finally:
            driver.close()

    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
