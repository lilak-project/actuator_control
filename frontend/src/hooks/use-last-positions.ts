import { useCallback, useEffect, useState } from "react"

import type { LastPosition } from "@/lib/types"
import { url } from "@/lib/portal-base"

/**
 * Where each axis was last left standing, keyed by IP.
 *
 * Read straight from the server's record rather than from a live session, so
 * it is still there for an axis that is switched off or disconnected.
 */
export function useLastPositions(refreshKey: string) {
  const [positions, setPositions] = useState<Record<string, LastPosition>>({})

  const refresh = useCallback(async () => {
    try {
      const response = await fetch(url("/api/last-positions"))
      if (response.ok) setPositions(await response.json())
    } catch {
      // Purely informational; a failure just means no "last seen" line.
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh, refreshKey])

  return positions
}
