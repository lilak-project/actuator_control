import type { ReactNode } from "react"
import { Button, Tooltip } from "@mantine/core"
import { Hold, Panel, Rail, Readout, StateDot, Tag } from "@neon"
import { Power, PowerOff, Target, Unplug } from "lucide-react"

import { SignalList } from "@/components/signal-list"
import { useAction } from "@/hooks/use-action"
import { api } from "@/lib/api"
import { mm, mmPerSec, percent } from "@/lib/format"
import { ORIGIN_NAME, ORIGIN_STEP, stateLabel, stateTone, stepLabel, type Gate } from "@/lib/gating"
import type { ActuatorStatus, StepNames, StepPosition } from "@/lib/types"

interface StatusPanelProps {
  status: ActuatorStatus
  /** Monitoring leaves the servo keys out. */
  control: boolean
  gate: Gate
  stepNames: StepNames
  steps: StepPosition[]
  onDisconnect: () => void
  disconnecting: boolean
  /** Reading depth, chosen in the header. */
  showAll: boolean
}

/**
 * Where the axis is, and the commands that decide whether it can move at all.
 *
 * Init / SV On / SV Off / Disconnect live here rather than with the step
 * controls because they are about the state of the machine, not about a move.
 */
export function StatusPanel({
  status,
  control,
  gate,
  stepNames,
  steps,
  onDisconnect,
  disconnecting,
  showAll,
}: StatusPanelProps) {
  const { pending, busy, run } = useAction()
  const parkedAt = stepLabel(status, stepNames)

  const track = (
    <Rail
      value={status.pos}
      min={0}
      max={trackMax(status, steps)}
      // Where it has been told to go, while it is not there yet.
      target={Math.abs(status.target - status.pos) > 0.05 ? status.target : null}
      // Mode 0 is an unregistered slot, not a place the axis can be sent --
      // marking all 64 would bury the handful that are real.
      marks={steps
        .filter((step) => step.mode !== 0)
        .map((step) => {
          const name = step.number === ORIGIN_STEP ? ORIGIN_NAME : step.name
          return { at: step.position, label: name || undefined, title: `Step ${step.number}${name ? ` · ${name}` : ""} — ${mm(step.position)} mm` }
        })}
      label={(v) => `${v.toFixed(0)} mm`}
    />
  )

  const tone = stateTone(status)

  return (
    <Panel
      // The name and IP are already on the tab; Rich says them again for the record.
      title={
        <>
          {showAll ? <>{status.name} <span className="faint tabular">{status.ip}</span></> : "Position"}{" "}
          {/* Where it is parked is a fact, not a reading (NEON rule 4). */}
          <Tag label="STEP">{parkedAt ? parkedAt.replace(/^Step /, "") : "not driven yet"}</Tag>
        </>
      }
      actions={
        <span className="act-badges">
          <StateDot tone={tone} reserve={["Alarm", "Not set up", "Servo off", "Moving", "Ready"]}>
            {stateLabel(status)}
          </StateDot>
          {status.hold ? <span className="tone-text-warn">▲ Hold</span> : null}
          {status.idle_off ? (
            <span className="tone-text-warn" title="No command for 5 minutes, so the servo was released. Press SV On to take the axis back.">
              ▲ Idle release
            </span>
          ) : null}
        </span>
      }
    >
      <div className="act-stack">
        <div className="act-hero">
          <Readout size="hero" label="Position" value={<Hold reserve={["888.88"]}>{mm(status.pos)}</Hold>} unit="mm" />
          {/* Minimum: the two things you watch while running, side by side. */}
          {showAll ? (
            <div className="act-row">
              <Readout label="Target" value={<Hold reserve={["888.88"]}>{mm(status.target)}</Hold>} unit="mm" />
              <Readout label="Speed" value={<Hold reserve={["888"]}>{mmPerSec(status.speed)}</Hold>} unit="mm/s" />
              <Readout label="Force" value={<Hold reserve={["888"]}>{percent(status.force)}</Hold>} unit="%" />
              <Readout label="Out" value={<Hold reserve={["88"]}>{String(status.out)}</Hold>} />
            </div>
          ) : (
            track
          )}
        </div>
        {showAll ? track : null}

        <SignalList signals={status.signals} showAll={showAll} />

        {status.alarms.some((alarm) => alarm.code !== 0) ? (
          <div className="act-badges">
            {status.alarms
              .filter((alarm) => alarm.code !== 0)
              .map((alarm, index) => (
                <span key={`${alarm.code}-${index}`} className="dim">
                  <b className="tabular tone-text-alarm">{alarm.code}</b> {alarm.name}
                </span>
              ))}
          </div>
        ) : null}

        {control ? (
        <div className="act-buttons">
          <Hint label="Return to origin and establish the coordinate system. Needs a live servo, and leaves it on.">
            <Button
              variant="default"
              leftSection={<Target size={16} />}
              loading={pending === "init"}
              disabled={busy || !gate.init}
              onClick={() => run("init", () => api.command(status.ip, "setup"), "Init complete — servo on")}
            >
              {pending === "init" ? "Homing…" : "Init"}
            </Button>
          </Hint>
          <Hint label="Servo on: energise the motor so the axis holds its position and can be driven.">
            <Button
              variant="default"
              leftSection={<Power size={16} />}
              loading={pending === "svon"}
              disabled={busy || !gate.svon}
              onClick={() => run("svon", () => api.command(status.ip, "svon"), "Servo on")}
            >
              SV On
            </Button>
          </Hint>
          <Hint label="Servo off: de-energise the motor. The stage stays where it is, but is no longer held and can be pushed by hand.">
            <Button
              variant="default"
              leftSection={<PowerOff size={16} />}
              loading={pending === "svoff"}
              disabled={busy || !gate.svoff}
              onClick={() => run("svoff", () => api.command(status.ip, "svoff"), "Servo off")}
            >
              SV Off
            </Button>
          </Hint>
          <Hint label="Close the session. Sends SV Off first whenever that is legal, so the axis is never left energised.">
            <Button variant="default" leftSection={<Unplug size={16} />} onClick={onDisconnect} loading={disconnecting} disabled={busy}>
              Disconnect
            </Button>
          </Hint>
        </div>
        ) : null}
      </div>
    </Panel>
  )
}

/** Tooltip wrapper that still works when the button inside is disabled. */
function Hint({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Tooltip label={label} withArrow multiline w={280}>
      <div>{children}</div>
    </Tooltip>
  )
}

/**
 * Top of the rail.
 *
 * The profile limit when there is one -- that is the travel the operator is
 * allowed to use. Otherwise fall back to the furthest thing actually in view,
 * because the controller never tells us the physical stroke.
 */
function trackMax(status: ActuatorStatus, steps: StepPosition[]): number {
  if (status.position_limit_enabled && status.max_position) return status.max_position
  const furthest = Math.max(status.pos, status.target, ...steps.map((step) => step.position), 1)
  return Math.ceil(furthest * 1.1)
}
