import { useCallback, useEffect, useRef, useState } from "react"

export interface Polled<T> {
  data: T | null
  /** The last failure, cleared by the next success. Null while things work. */
  error: string | null
  /** True only until the first answer, so the page does not flash "no data". */
  loading: boolean
  refresh: () => Promise<void>
}

/**
 * Re-read something from the control service on a fixed interval.
 *
 * The live axis readouts arrive over the WebSocket; this is for the things
 * that do not -- the report, the last positions, the log -- which change when
 * someone drives an axis rather than several times a second.
 *
 * The previous value is kept while a refresh is in flight, so a blip in the
 * control service blanks nothing: the numbers simply stop advancing, and the
 * header's Live badge is what says why.
 */
export function usePoll<T>(fetcher: () => Promise<T>, intervalMs: number, key = ""): Polled<T> {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  // Held in a ref so changing the fetcher's identity every render -- which an
  // inline arrow does -- cannot restart the timer on every tick.
  const fetcherRef = useRef(fetcher)
  fetcherRef.current = fetcher

  const refresh = useCallback(async () => {
    try {
      setData(await fetcherRef.current())
      setError(null)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    let stopped = false
    const tick = async () => {
      if (!stopped) await refresh()
    }
    void tick()
    const timer = setInterval(tick, intervalMs)
    return () => {
      stopped = true
      clearInterval(timer)
    }
  }, [refresh, intervalMs, key])

  return { data, error, loading, refresh }
}
