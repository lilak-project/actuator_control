import { Facts, Panel } from "@neon"

import { AlarmBanner } from "@/components/alarm-banner"
import { MovePanel } from "@/components/move-panel"
import { StatusPanel } from "@/components/status-panel"
import { StepTable } from "@/components/step-table"
import { useSteps } from "@/hooks/use-steps"
import { ago, mm } from "@/lib/format"
import { gate } from "@/lib/gating"
import type { ActuatorStatus, LastPosition, StepNames } from "@/lib/types"

interface ActuatorPanelProps {
  status: ActuatorStatus
  /** Control draws the commands; monitoring draws what was done instead. */
  control: boolean
  /** The server's own record for this axis, which outlives a move. */
  last: LastPosition | undefined
  stepNames: StepNames
  onStepNamesChange: (names: StepNames) => void
  onDisconnect: () => void
  disconnecting: boolean
  /** Reading depth, chosen once in the header and shared by every tab. */
  showAll: boolean
}

/**
 * One axis: where it is, then either what to do with it (control) or where it
 * was last driven and which stored step it is sitting on (monitoring) -- the
 * question a watcher asks is "which of these is it on", not "which do I send".
 */
export function ActuatorPanel({
  status,
  control,
  last,
  stepNames,
  onStepNamesChange,
  onDisconnect,
  disconnecting,
  showAll,
}: ActuatorPanelProps) {
  const permissions = gate(status)
  const { steps, refresh } = useSteps(status.ip)

  return (
    <div className="act-stack">
      <AlarmBanner status={status} />

      <StatusPanel
        status={status}
        control={control}
        gate={permissions}
        stepNames={stepNames}
        steps={steps}
        onDisconnect={onDisconnect}
        disconnecting={disconnecting}
        showAll={showAll}
      />

      {control ? (
        <MovePanel
          status={status}
          gate={permissions}
          steps={steps}
          onStepNamesChange={onStepNamesChange}
          onStepsChanged={() => void refresh()}
          showAll={showAll}
        />
      ) : (
        <>
          <LastMove last={last} />
          <StepTable steps={steps} currentStep={status.last_step_number} position={status.pos} showAll={showAll} />
        </>
      )}
    </div>
  )
}

/**
 * The last move recorded for this axis. Redundant while the axis sits still,
 * and the whole point the moment it does not: it survives SV Off, a
 * disconnect, and the service being restarted.
 */
function LastMove({ last }: { last: LastPosition | undefined }) {
  if (!last) {
    return (
      <Panel title="Last move">
        <span className="faint">No move recorded for this axis yet.</span>
      </Panel>
    )
  }
  const where =
    last.step === null || last.step < 0 ? "between steps" : last.name ? `Step ${last.step} · ${last.name}` : `Step ${last.step}`
  // History, not a reading: plain facts, not big numbers (NEON rule 4).
  return (
    <Panel title="Last move recorded">
      <Facts
        items={[
          ["Step", where],
          ["Left at", `${mm(last.position)} mm`],
          ["Recorded", ago(last.at)],
        ]}
      />
    </Panel>
  )
}
