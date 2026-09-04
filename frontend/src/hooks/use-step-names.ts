import { useCallback, useEffect, useRef, useState } from "react"

import { api } from "@/lib/api"
import type { StepNames } from "@/lib/types"

type NamesByIp = Record<string, StepNames>

/**
 * Step labels for every connected actuator, keyed by IP.
 *
 * They are needed in two places at once -- the tab label and the step card --
 * so they are fetched once here rather than per panel.
 */
export function useStepNames(ips: string[]) {
  const [names, setNames] = useState<NamesByIp>({})
  const loaded = useRef(new Set<string>())
  const key = ips.join(",")

  useEffect(() => {
    for (const ip of ips) {
      if (loaded.current.has(ip)) continue
      loaded.current.add(ip)
      api
        .readStepNames(ip)
        .then((value) => setNames((current) => ({ ...current, [ip]: value })))
        .catch(() => loaded.current.delete(ip))
    }
    // Forget disconnected actuators so a later reconnect re-reads them.
    for (const ip of loaded.current) {
      if (!ips.includes(ip)) loaded.current.delete(ip)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  const update = useCallback((ip: string, value: StepNames) => {
    setNames((current) => ({ ...current, [ip]: value }))
  }, [])

  const forIp = useCallback((ip: string): StepNames => names[ip] ?? {}, [names])

  return { forIp, update }
}
