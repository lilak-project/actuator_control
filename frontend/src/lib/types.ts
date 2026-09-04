/** Shapes returned by the backend.  Kept in step with `backend/app/schemas.py`. */

export interface Profile {
  name: string
  ip: string
  position_limit_enabled: boolean
  max_position: number | null
}

/** The ten discrete signals the controller reports in its input map. */
export interface Signals {
  busy: boolean
  svre: boolean
  seton: boolean
  inp: boolean
  area: boolean
  warea: boolean
  estop: boolean
  alarm: boolean
  ready: boolean
  alarmf: boolean
}

export type SignalName = keyof Signals

export interface AlarmInfo {
  code: number
  name: string
  /** What to check on the machine.  Only set for the critical (group E) codes. */
  hint?: string
  /** "power_cycle" means Reset will not clear it. */
  recovery?: "power_cycle" | "reset_svon" | "reset"
}

/** One row of the controller's alarm table, from `/api/reference/alarms`. */
export interface AlarmReference {
  code: number
  name: string
  /** Manual §15.2 group: B and C clear with RESET, D needs SV On after it, E a power cycle. */
  group: "B" | "C" | "D" | "E"
  recovery: "reset" | "reset_svon" | "power_cycle"
  hint: string
}

export interface LimitViolation {
  number: number
  position: number
  limit: number
}

/** One actuator's full status; pushed over the WebSocket several times a second. */
export interface ActuatorStatus {
  ip: string
  name: string
  connected: boolean
  last_error: string
  hold: boolean
  setup_done: boolean
  last_step_number: number | null
  position_limit_enabled: boolean
  max_position: number | null
  limit_violations: LimitViolation[]
  limit_error: string
  /** True when the idle watchdog released the servo; cleared by any command. */
  idle_off: boolean
  critical_alarms: AlarmInfo[]
  signals: Signals
  out: number
  pos: number
  speed: number
  force: number
  target: number
  alarms: AlarmInfo[]
}

/** Where an axis was last left, kept on the server across disconnects. */
export interface LastPosition {
  step: number | null
  position: number
  /** ISO timestamp of when it was recorded. */
  at: string
  name: string
}

/** One slot of the stored step table, as plotted on the position track. */
export interface StepPosition {
  number: number
  position: number
  mode: number
  name: string
}

export interface StepData {
  mode: number
  speed: number
  pos: number
  accel: number
  decel: number
  push: number
  trig: number
  p_speed: number
  m_force: number
  area1: number
  area2: number
  width: number
}

export interface StepResponse extends StepData {
  number: number
  name: string
}

export type CommandName = "setup" | "svon" | "svoff" | "reset" | "hold" | "move"

export type StepNames = Record<string, string>
