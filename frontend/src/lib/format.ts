/** Formatting for the numeric readouts.  All fixed-width so digits don't jump. */

export const mm = (value: number) => `${value.toFixed(2)}`
export const mmPerSec = (value: number) => `${value.toFixed(0)}`
export const percent = (value: number) => `${value.toFixed(0)}`

/** Clamp a user-entered number, returning `fallback` for blank or NaN input. */
export function toNumber(raw: string, fallback = 0): number {
  const value = Number(raw)
  return raw.trim() === "" || Number.isNaN(value) ? fallback : value
}

/** "Step 3 · 3 cm — 36.23 mm, 2 h ago", for an axis nobody is connected to. */
export function describeLastPosition(last: {
  step: number | null
  name: string
  position: number
  at: string
}): string {
  const where =
    last.step === null || last.step < 0
      ? "between steps"
      : last.name
        ? `step ${last.step} · ${last.name}`
        : `step ${last.step}`
  return `last left at ${where} — ${last.position.toFixed(2)} mm, ${ago(last.at)}`
}

/** "2 h ago".  Coarse on purpose: nobody reads a wall display to the second. */
export function ago(iso: string): string {
  const seconds = (Date.now() - new Date(iso).getTime()) / 1000
  if (!Number.isFinite(seconds) || seconds < 0) return "just now"
  if (seconds < 90) return "just now"
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 48) return `${hours} h ago`
  return `${Math.round(hours / 24)} d ago`
}

/** "2026-09-01 14:32" — the reading itself, for when "2 h ago" is not enough. */
export function stamp(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  const pad = (value: number) => String(value).padStart(2, "0")
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}`
  )
}

/** Just the clock, for a log where every line is from the same day or two. */
export function clock(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  const pad = (value: number) => String(value).padStart(2, "0")
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}
