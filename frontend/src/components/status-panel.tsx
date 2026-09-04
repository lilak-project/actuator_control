import type { ReactNode } from "react"
import { Badge, Box, Button, Divider, Group, Paper, Stack, Text, Tooltip } from "@mantine/core"
import { Power, PowerOff, Target, Unplug } from "lucide-react"

import { PositionTrack } from "@/components/position-track"
import { Readout } from "@/components/readout"
import { SignalList } from "@/components/signal-list"
import { useAction } from "@/hooks/use-action"
import { api } from "@/lib/api"
import { mm, mmPerSec, percent } from "@/lib/format"
import { stateLabel, stepLabel, type Gate } from "@/lib/gating"
import type { ActuatorStatus, StepNames, StepPosition } from "@/lib/types"

interface StatusPanelProps {
  status: ActuatorStatus
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
    <PositionTrack
      position={status.pos}
      target={status.target}
      steps={steps}
      max={trackMax(status, steps)}
    />
  )

  const hero = (
    <Stack gap={2}>
      {/* Carries the state badges, so they survive the Minimum view where the
          name/IP header is gone. */}
      <Group gap="xs" wrap="wrap">
        <Text fw={600} size="md" c={parkedAt ? undefined : "dimmed"}>
          {parkedAt ?? "Not driven yet"}
        </Text>
        <Badge
          size="md"
          radius="sm"
          variant="light"
          color={status.critical_alarms.length ? "red" : "gray"}
        >
          {stateLabel(status)}
        </Badge>
        {status.hold ? (
          <Badge size="md" radius="sm" variant="light" color="orange">
            Hold
          </Badge>
        ) : null}
        {status.idle_off ? (
          <Tooltip
            label="No command for 5 minutes, so the servo was released. Press SV On to take the axis back."
            withArrow
            multiline
            w={280}
          >
            <Badge size="md" radius="sm" variant="light" color="orange">
              Idle release
            </Badge>
          </Tooltip>
        ) : null}
      </Group>
      <Text size="xs" c="dimmed" fw={500}>
        Current position
      </Text>
      <Text
        className="tabular"
        fw={600}
        lh={1}
        style={{ fontSize: "clamp(2rem, 4vw, 2.75rem)" }}
      >
        {mm(status.pos)}
        <Text span c="dimmed" fw={400} ml="xs" style={{ fontSize: "1.05rem" }}>
          mm
        </Text>
      </Text>
    </Stack>
  )

  return (
    // Minimum drops the name/IP header, so the readout can sit closer to the
    // top edge without the card feeling cramped.
    <Paper withBorder p="lg" pt={showAll ? "lg" : "sm"} shadow="xs">
      {/* The name and IP are already on the tab; in Minimum they are just
          another line between the operator and the readout. */}
      {showAll ? (
        <Group gap="sm" wrap="wrap" mb="md">
          <Text fw={600} size="md">
            {status.name}
          </Text>
          <Text className="tabular" c="dimmed" size="sm">
            {status.ip}
          </Text>
        </Group>
      ) : null}

      {showAll ? (
        <Stack gap="md">
          <Group justify="space-between" align="flex-end" wrap="wrap" gap="lg">
            {hero}
            <Group gap="xl" align="flex-end">
              <Readout label="Target" value={mm(status.target)} unit="mm" />
              <Readout label="Speed" value={mmPerSec(status.speed)} unit="mm/s" />
              <Readout label="Force" value={percent(status.force)} unit="%" />
              <Readout label="Out" value={String(status.out)} />
            </Group>
          </Group>
          {track}
        </Stack>
      ) : (
        // Minimum: the two things you watch while running, side by side.
        <Group align="center" wrap="nowrap" gap="xl">
          {hero}
          <Box style={{ flex: 1, minWidth: 0 }}>{track}</Box>
        </Group>
      )}

      <Box mt="md">
        <SignalList signals={status.signals} showAll={showAll} />
      </Box>

      {status.alarms.some((alarm) => alarm.code !== 0) ? (
        <Group gap="lg" mt="sm">
          {status.alarms
            .filter((alarm) => alarm.code !== 0)
            .map((alarm, index) => (
              <Text key={`${alarm.code}-${index}`} size="sm" c="dimmed">
                <Text span className="tabular" fw={600} c="red">
                  {alarm.code}
                </Text>{" "}
                {alarm.name}
              </Text>
            ))}
        </Group>
      ) : null}

      <Divider my="md" />

      <Group gap="md" wrap="wrap">
        <Hint label="Return to origin and establish the coordinate system. Needs a live servo, and leaves it on.">
          <Button
            variant="light"
            leftSection={<Target size={18} />}
            loading={pending === "init"}
            disabled={busy || !gate.init}
            onClick={() =>
              run("init", () => api.command(status.ip, "setup"), "Init complete — servo on")
            }
          >
            {pending === "init" ? "Homing…" : "Init"}
          </Button>
        </Hint>
        <Hint label="Servo on: energise the motor so the axis holds its position and can be driven.">
          <Button
            variant="light"
            color="teal"
            leftSection={<Power size={18} />}
            loading={pending === "svon"}
            disabled={busy || !gate.svon}
            onClick={() => run("svon", () => api.command(status.ip, "svon"), "Servo on")}
          >
            SV On
          </Button>
        </Hint>
        <Hint label="Servo off: de-energise the motor. The stage stays where it is, but is no longer held and can be pushed by hand.">
          <Button
            variant="light"
            color="gray"
            leftSection={<PowerOff size={18} />}
            loading={pending === "svoff"}
            disabled={busy || !gate.svoff}
            onClick={() => run("svoff", () => api.command(status.ip, "svoff"), "Servo off")}
          >
            SV Off
          </Button>
        </Hint>
        <Hint label="Close the session. Sends SV Off first whenever that is legal, so the axis is never left energised.">
          <Button
            variant="light"
            color="orange"
            leftSection={<Unplug size={18} />}
            onClick={onDisconnect}
            loading={disconnecting}
            disabled={busy}
          >
            Disconnect
          </Button>
        </Hint>
      </Group>
    </Paper>
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
