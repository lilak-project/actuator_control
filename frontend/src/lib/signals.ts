import type { SignalName } from "./types"

/** How an active signal should read: is it reassuring, routine, or a fault? */
export type SignalTone = "ok" | "neutral" | "critical"

interface SignalMeta {
  tone: SignalTone
  description: string
}

/**
 * The ten JXC91 input signals, in the order an operator scans them: servo
 * chain first, then motion, then position windows, then faults.
 */
export const SIGNALS: Record<SignalName, SignalMeta> = {
  svre: { tone: "ok", description: "Servo is on" },
  seton: { tone: "ok", description: "Origin established — Setup has completed" },
  ready: { tone: "ok", description: "Controller is ready to accept a command" },
  inp: { tone: "ok", description: "In position, or pushing force reached" },
  busy: { tone: "neutral", description: "An operation is in progress" },
  area: { tone: "neutral", description: "Position is inside the step's AREA window" },
  warea: { tone: "neutral", description: "Position is inside the W-AREA window" },
  alarm: { tone: "critical", description: "Controller alarm is active" },
  alarmf: { tone: "critical", description: "Alarm flag is latched" },
  estop: { tone: "critical", description: "Emergency stop input is active" },
}

export const SIGNAL_ORDER = Object.keys(SIGNALS) as SignalName[]
