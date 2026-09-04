"""JXC91 alarm code table.

Codes are the 3-digit decimal values reported in the controller's input map
(``alarms[0..3]``).  ``CRITICAL_CODES`` are the subset that block every command.

The manual (§15.1) splits alarms into groups B-E.  Groups B/C/D clear with
RESET (D also needs SVON afterwards); group E "cannot be cleared unless the
power supply control (24 VC) is turned OFF once" -- RESET does nothing for it,
and because SETON drops as well, the axis needs Init again after the restart.
"""

from __future__ import annotations

ALARM_NAMES: dict[int, str] = {
    48: "Drive data value is wrong",
    49: "Parameter value is wrong",
    51: "Step data is not registered",
    52: "Stroke is outside stroke limit",
    58: "Numerical instruction data value is wrong",
    61: "Numerical instruction step data is not registered",
    62: "Numerical instruction stroke is outside stroke limit",
    96: "Reacting force is outside limit when pushing",
    97: "Return to origin did not complete in set time",
    98: "Drive is ON when SVRE is OFF",
    99: "Drive is ON when SETON is OFF",
    103: "Origin sensor was not detected",
    144: "Speed exceeded set value",
    145: "Motor power supply voltage is outside set range",
    146: "Controller temperature exceeded set range",
    147: "Controller supply voltage is outside set range",
    148: "Current limit is exceeded",
    149: "Target position was not reached within time limit",
    150: "Communication error with higher-level device",
    192: "Encoder error",
    193: "Unable to find motor phase in set time",
    194: "Output current limit exceeded set value",
    195: "Current sensor abnormality",
    196: "Position deviation counter overflow",
    197: "Memory abnormality",
    198: "CPU error",
}

#: Manual §15.2, "Group" column.  B and C clear with RESET, D needs SVON after
#: it, E needs the controller's control power cycled.
ALARM_GROUPS: dict[int, str] = {
    48: "B", 49: "B", 51: "B", 52: "B", 58: "B", 61: "B", 62: "B",
    96: "C", 97: "C", 98: "C", 99: "C", 103: "C",
    144: "D", 145: "D", 146: "D", 147: "D", 148: "D", 149: "D", 150: "D",
    192: "E", 193: "E", 194: "E", 195: "E", 196: "E", 197: "E", 198: "E",
}

#: Alarm group E (manual §15.2): SVRE and SETON both drop and RESET is
#: powerless -- only cycling the controller's 24 V control power clears these.
POWER_CYCLE_CODES: frozenset[int] = frozenset(
    code for code, group in ALARM_GROUPS.items() if group == "E"
)

#: Alarms that make the controller refuse motion; commands are blocked locally
#: as well so we never push a drive signal into a faulted axis.
CRITICAL_CODES: frozenset[int] = POWER_CYCLE_CODES

#: What the operator has to do to get the axis back.
RECOVERY_POWER_CYCLE = "power_cycle"  # group E
RECOVERY_RESET_SVON = "reset_svon"  # group D: RESET drops the servo too
RECOVERY_RESET = "reset"  # groups B and C

#: One line of "what to check", condensed from each entry's <Countermeasure>.
ALARM_HINTS: dict[int, str] = {
    48: "Step data is out of range. Area1 < Area2, Trigger ≤ Push force, and "
        "actuator minimum speed ≤ Push speed ≤ Speed.",
    49: "A basic parameter is out of range: Stroke(-) < Stroke(+), "
        "W-Area1 < W-Area2, and Max pushing force within the actuator's.",
    51: "The step number driven has no data. Its Mode must be 1 (ABS) or 2 (INC), not 0.",
    52: "The move would leave the Stroke(+)/Stroke(-) window set in the basic parameters.",
    58: "Same range check as 048, for a numerical-instruction move.",
    61: "Same as 051, for a numerical-instruction move.",
    62: "Same as 052, for a numerical-instruction move.",
    96: "The workpiece pushed the actuator back. Increase the pushing force, or "
        "start the push further from the object.",
    97: "Homing did not finish in time. Clear whatever is obstructing the axis.",
    98: "A move was commanded with the servo off. Press SV On first.",
    99: "A move was commanded before homing. Run Init first.",
    103: "The origin sensor was not found. Check the sensor and the ORIG sensor parameters.",
    144: "The motor was driven past its maximum speed by an external force.",
    145: "Motor power (M24V) out of range. Check the supply, especially during "
         "acceleration and deceleration.",
    146: "The controller is too hot. Improve the airflow around it.",
    147: "Control power (C24V) out of range. Check the supply.",
    148: "Accumulated output current too high. Check for obstructions, and that "
         "load, speed and acceleration are within the actuator's spec.",
    149: "The axis did not reach the target in time. Check for obstructions and "
         "that load, speed and acceleration are within spec.",
    150: "The PC or teaching box connection dropped. Reconnect it and reset from there.",
    192: "Check the actuator cable and both connectors (controller side and actuator side).",
    193: "Clear whatever is obstructing the actuator, then turn the servo on again. "
         "The first SVON after power-on moves the axis slightly to find the motor phase.",
    194: "Check the actuator cable and connectors for a short circuit, and that the "
         "actuator matches the controller.",
    195: "Check that the actuator matches the controller. If it returns after a "
         "power cycle, contact SMC.",
    196: "Position error counter overflowed. Clear any obstruction and check that "
         "load, speed and acceleration are within spec.",
    197: "EEPROM failure — contact SMC.",
    198: "CPU fault. If it comes back after the power cycle, contact SMC.",
}


def alarm_name(code: int) -> str:
    return ALARM_NAMES.get(code, "")


def alarm_hint(code: int) -> str:
    return ALARM_HINTS.get(code, "")


def alarm_group(code: int) -> str:
    return ALARM_GROUPS.get(code, "")


def recovery(code: int) -> str:
    """How the operator clears ``code``, from its group."""
    group = ALARM_GROUPS.get(code, "")
    if group == "E":
        return RECOVERY_POWER_CYCLE
    if group == "D":
        return RECOVERY_RESET_SVON
    return RECOVERY_RESET


def alarm_table() -> list[dict]:
    """The whole table, for the reference screen."""
    return [
        {
            "code": code,
            "name": ALARM_NAMES.get(code, ""),
            "group": group,
            "recovery": recovery(code),
            "hint": ALARM_HINTS.get(code, ""),
        }
        for code, group in sorted(ALARM_GROUPS.items())
    ]


def is_critical(code: int) -> bool:
    return code in CRITICAL_CODES
