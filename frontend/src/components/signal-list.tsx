import { Badge, Group, Tooltip } from "@mantine/core"

import { SIGNAL_ORDER, SIGNALS, type SignalTone } from "@/lib/signals"
import type { Signals } from "@/lib/types"

const TONE_COLOR: Record<SignalTone, string> = {
  ok: "teal",
  neutral: "blue",
  critical: "red",
}

/**
 * The controller's ten discrete signals.
 *
 * Minimum view lists only what is currently true, which is what you want while
 * running. Show all lists every signal with its state, which is what you want
 * when diagnosing why something is not READY.
 */
export function SignalList({ signals, showAll }: { signals: Signals; showAll: boolean }) {
  const shown = showAll ? SIGNAL_ORDER : SIGNAL_ORDER.filter((name) => signals[name])

  if (shown.length === 0) {
    return (
      <Badge size="md" radius="sm" variant="outline" color="gray">
        no active signals
      </Badge>
    )
  }

  return (
    <Group gap="xs">
      {shown.map((name) => {
        const on = signals[name]
        return (
          <Tooltip key={name} label={SIGNALS[name].description} withArrow>
            <Badge
              size="md"
              radius="sm"
              variant={on ? "light" : "outline"}
              color={on ? TONE_COLOR[SIGNALS[name].tone] : "gray"}
              styles={{ label: { letterSpacing: "0.04em" } }}
            >
              {name}
            </Badge>
          </Tooltip>
        )
      })}
    </Group>
  )
}
