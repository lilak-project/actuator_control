import { Flags, type Tone } from "@neon"

import { SIGNAL_ORDER, SIGNALS, type SignalTone } from "@/lib/signals"
import type { Signals } from "@/lib/types"

const TONE: Record<SignalTone, Tone> = { ok: "ok", neutral: "ok", critical: "alarm" }

/**
 * The controller's ten discrete signals.
 *
 * Minimum lists only what is currently true, which is what you want while
 * running. Rich lists every signal with its state, which is what you want
 * when diagnosing why something is not READY.
 */
export function SignalList({ signals, showAll }: { signals: Signals; showAll: boolean }) {
  const shown = showAll ? SIGNAL_ORDER : SIGNAL_ORDER.filter((name) => signals[name])
  if (shown.length === 0) return <span className="faint">no active signals</span>
  return (
    <Flags
      items={shown.map((name) => ({
        label: name.toUpperCase(),
        on: signals[name],
        tone: TONE[SIGNALS[name].tone],
        title: SIGNALS[name].description,
      }))}
    />
  )
}
