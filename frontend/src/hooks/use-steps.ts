import { useCallback, useEffect, useState } from "react"

import { api } from "@/lib/api"
import type { StepPosition } from "@/lib/types"

/**
 * Stored step positions for one actuator, for the position track.
 *
 * The backend serves these from a cached scan, so fetching is cheap; it still
 * only happens on connect and after a step is written, since that is the only
 * time they change.
 */
export function useSteps(ip: string) {
  const [steps, setSteps] = useState<StepPosition[]>([])

  const refresh = useCallback(async () => {
    try {
      setSteps(await api.readSteps(ip))
    } catch {
      // A failed scan just means an empty track; the status panel reports why.
    }
  }, [ip])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return { steps, refresh }
}
