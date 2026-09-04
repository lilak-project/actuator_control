import { Stack } from "@mantine/core"

import { AlarmBanner } from "@/components/alarm-banner"
import { MovePanel } from "@/components/move-panel"
import { StatusPanel } from "@/components/status-panel"
import { useSteps } from "@/hooks/use-steps"
import { gate } from "@/lib/gating"
import type { ActuatorStatus, StepNames } from "@/lib/types"

interface ActuatorPanelProps {
  status: ActuatorStatus
  stepNames: StepNames
  onStepNamesChange: (names: StepNames) => void
  onDisconnect: () => void
  disconnecting: boolean
  /** Reading depth, chosen once in the header and shared by every tab. */
  showAll: boolean
}

/** One axis: where it is (box 1), and what to do with it (box 2). */
export function ActuatorPanel({
  status,
  stepNames,
  onStepNamesChange,
  onDisconnect,
  disconnecting,
  showAll,
}: ActuatorPanelProps) {
  const permissions = gate(status)
  const { steps, refresh } = useSteps(status.ip)

  return (
    <Stack gap="lg">
      <AlarmBanner status={status} />

      <StatusPanel
        status={status}
        gate={permissions}
        stepNames={stepNames}
        steps={steps}
        onDisconnect={onDisconnect}
        disconnecting={disconnecting}
        showAll={showAll}
      />

      <MovePanel
        status={status}
        gate={permissions}
        steps={steps}
        onStepNamesChange={onStepNamesChange}
        onStepsChanged={() => void refresh()}
        showAll={showAll}
      />
    </Stack>
  )
}
