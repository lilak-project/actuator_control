import { Notice } from "@neon"

import type { ActuatorStatus } from "@/lib/types"

/**
 * The two things that must never be missed: a critical alarm (every command is
 * blocked) and a stored step sitting above the profile's position limit.
 */
export function AlarmBanner({ status }: { status: ActuatorStatus }) {
  const critical = status.critical_alarms
  const violations = status.limit_violations

  if (critical.length > 0) {
    // Manual §15.1: group E alarms survive RESET -- only cycling the
    // controller's 24 V control power clears them, and Init is needed after.
    const powerCycle = critical.some((alarm) => alarm.recovery === "power_cycle")
    return (
      <Notice tone="alarm" title="Critical alarm — every command is blocked">
        {critical.map((alarm) => (
          <span key={alarm.code} style={{ display: "block" }}>
            <b className="tabular">{alarm.code}</b>
            {alarm.name ? ` — ${alarm.name}` : null}
            {alarm.hint ? <span className="dim"> · {alarm.hint}</span> : null}
          </span>
        ))}
        <span style={{ display: "block", marginTop: 4 }}>
          {powerCycle
            ? "Reset will not clear this one. Fix the cause, switch the controller's 24 V control power off and on, then run Init again."
            : "Clear the fault at the controller, then press Reset."}
        </span>
      </Notice>
    )
  }

  if (status.limit_error) {
    return (
      <Notice tone="warn" title="Position limit could not be checked">
        {status.limit_error} — Move stays disabled.
      </Notice>
    )
  }

  if (violations.length > 0) {
    return (
      <Notice
        tone="warn"
        title={`${violations.length} stored step${violations.length > 1 ? "s are" : " is"} above the ${status.max_position?.toFixed(2)} mm limit`}
      >
        <span className="tabular">
          {violations
            .slice(0, 8)
            .map((item) => `#${item.number} → ${item.position.toFixed(2)} mm`)
            .join("   ")}
          {violations.length > 8 ? `   +${violations.length - 8} more` : ""}
        </span>
        {" — Move is disabled until every stored step is within the limit."}
      </Notice>
    )
  }

  return null
}
