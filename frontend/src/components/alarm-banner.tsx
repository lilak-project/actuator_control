import { Alert, List, Text } from "@mantine/core"
import { OctagonAlert, TriangleAlert } from "lucide-react"

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
      <Alert
        variant="light"
        color="red"
        radius="md"
        icon={<OctagonAlert />}
        title="Critical alarm — every command is blocked"
      >
        <List size="sm" spacing={4}>
          {critical.map((alarm) => (
            <List.Item key={alarm.code}>
              <Text span className="tabular" fw={600}>
                {alarm.code}
              </Text>
              {alarm.name ? ` — ${alarm.name}` : null}
              {alarm.hint ? (
                <Text size="sm" c="dimmed">
                  {alarm.hint}
                </Text>
              ) : null}
            </List.Item>
          ))}
        </List>
        <Text size="sm" mt="xs">
          {powerCycle
            ? "Reset will not clear this one. Fix the cause, switch the controller's 24 V control power off and on, then run Init again."
            : "Clear the fault at the controller, then press Reset."}
        </Text>
      </Alert>
    )
  }

  if (status.limit_error) {
    return (
      <Alert
        variant="light"
        color="orange"
        radius="md"
        icon={<TriangleAlert />}
        title="Position limit could not be checked"
      >
        {status.limit_error} — Move stays disabled.
      </Alert>
    )
  }

  if (violations.length > 0) {
    return (
      <Alert
        variant="light"
        color="orange"
        radius="md"
        icon={<TriangleAlert />}
        title={`${violations.length} stored step${violations.length > 1 ? "s are" : " is"} above the ${status.max_position?.toFixed(2)} mm limit`}
      >
        <Text size="sm" className="tabular">
          {violations
            .slice(0, 8)
            .map((item) => `#${item.number} → ${item.position.toFixed(2)} mm`)
            .join("   ")}
          {violations.length > 8 ? `   +${violations.length - 8} more` : ""}
        </Text>
        <Text size="sm" mt="xs">
          Move is disabled until every stored step is within the limit.
        </Text>
      </Alert>
    )
  }

  return null
}
