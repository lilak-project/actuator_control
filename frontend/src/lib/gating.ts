import type { Tone } from "@neon"

import type { ActuatorStatus, ReportRow } from "./types"

/** Slot 0 is reserved for Init: fixed name, not editable, not deletable. */
export const ORIGIN_STEP = 0
export const ORIGIN_NAME = "Init"

/**
 * Which controls are legal right now.
 *
 * Mirrors what the backend enforces, so the UI greys a button out instead of
 * letting the operator fire a command that will be rejected. Nothing here is
 * a safety boundary on its own -- the backend refuses the same cases.
 */
export interface Gate {
  init: boolean
  svon: boolean
  /** Also decides whether Disconnect sends SV Off on its way out. */
  svoff: boolean
  /** Stop: discards the remaining travel and clears resettable alarms. */
  stop: boolean
  move: boolean
  editStep: boolean
  editLimit: boolean
  /** Why Move is blocked, when it is. */
  moveBlockedReason: string | null
}

export function gate(status: ActuatorStatus): Gate {
  const setupDone = status.setup_done
  const servoOn = status.signals.svre
  const operable = setupDone && servoOn
  const moving = status.signals.busy
  // Group B-D alarms drop SVRE and are ignored until RESET is pulsed (manual
  // §15.1): without this the one button that clears them would be disabled by
  // the very state they cause. Group E is excluded -- RESET cannot clear it.
  const resettableAlarm = status.signals.alarm && status.critical_alarms.length === 0

  const moveBlockedReason = !operable
    ? setupDone
      ? "Servo is off — press SV On"
      : "Run Init first"
    : moving
      ? "The axis is still moving — press Stop to abandon it"
      : status.limit_error
      ? `Position limit check failed: ${status.limit_error}`
      : status.limit_violations.length > 0
        ? `${status.limit_violations.length} step(s) are above the ${status.max_position?.toFixed(2)} mm limit`
        : null

  return {
    // Homing needs a live servo. Before Init there is nothing else to press;
    // after an SV Off, SV On comes first.
    init: !setupDone || servoOn,
    // Init leaves the servo on, so SV On is only useful after an SV Off.
    svon: setupDone && !servoOn,
    svoff: operable,
    // There is nothing to stop unless the axis is actually travelling: Stop
    // comes alive when Move is pressed and goes quiet when the move lands.
    stop: (operable && moving) || resettableAlarm,
    move: operable && !moving && moveBlockedReason === null,
    // Writing the step table is a parameter write, not motion: the controller
    // accepts it with the servo off, and before Init.
    editStep: true,
    editLimit: operable,
    moveBlockedReason,
  }
}

/** The axis's overall state: what it is doing, not where it is. */
export function stateLabel(status: ActuatorStatus): string {
  if (status.critical_alarms.length > 0) return "Alarm"
  if (!status.setup_done) return "Not set up"
  if (!status.signals.svre) return "Servo off"
  if (status.signals.busy) return "Moving"
  return "Ready"
}

/**
 * The tab's colour, which says at a glance whether the axis can be driven:
 * lit when Init is done and the servo is live, dim when it is not (for either
 * reason), pink on a critical alarm.
 */
export function stateTone(status: ActuatorStatus): Tone {
  if (status.critical_alarms.length > 0) return "alarm"
  return status.setup_done && status.signals.svre ? "ok" : "idle"
}

/**
 * Which step the axis is parked at, or null if it has not been driven yet.
 *
 * Deliberately survives SV Off: the operator still needs to know where the
 * stage was left standing.
 */
export function stepLabel(
  status: ActuatorStatus,
  stepNames: Record<string, string>,
): string | null {
  const number = status.last_step_number
  if (number === null) return null
  // -1 is set by Stop: the move was abandoned part-way, so the axis is between
  // steps and the operator has to choose one again.
  if (number < 0) return "Step -1 · stopped"
  if (number === ORIGIN_STEP) return `Step ${ORIGIN_STEP} · ${ORIGIN_NAME}`
  const name = stepNames[String(number)]
  return name ? `Step ${number} · ${name}` : `Step ${number}`
}

/** The same label from a report row or a log record, which carry their own name. */
export function reportStepLabel(row: Pick<ReportRow, "step" | "step_name" | "stopped">): string | null {
  if (row.stopped) return "Step -1 · stopped"
  return describeStep(row.step, row.step_name)
}

function describeStep(number: number | null, name: string): string | null {
  if (number === null) return null
  // -1 is set by Stop: the move was abandoned part-way, so the axis is between
  // steps and whoever is driving has to choose one again.
  if (number < 0) return "Step -1 · stopped"
  if (number === ORIGIN_STEP) return `Step ${ORIGIN_STEP} · ${ORIGIN_NAME}`
  return name ? `Step ${number} · ${name}` : `Step ${number}`
}

/** A report row's colour, matching stateTone() for the axes that are connected. */
export function rowTone(row: ReportRow): Tone {
  if (row.alarms.length > 0) return "alarm"
  if (!row.connected) return "idle"
  return row.homed && row.servo_on ? "ok" : "idle"
}

/** What a report row is doing, in the same words as stateLabel(). */
export function rowLabel(row: ReportRow): string {
  if (!row.connected) return "Offline"
  if (row.alarms.length > 0) return "Alarm"
  if (!row.homed) return "Not set up"
  if (!row.servo_on) return "Servo off"
  if (row.moving) return "Moving"
  return "Ready"
}
