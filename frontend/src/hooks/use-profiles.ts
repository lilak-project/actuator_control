import { useCallback, useEffect, useState } from "react"
import { notifications } from "@mantine/notifications"

import { api, errorMessage } from "@/lib/api"
import type { Profile } from "@/lib/types"

/** The saved actuator profiles, refreshed whenever something writes to them. */
export function useProfiles() {
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    try {
      setProfiles(await api.listProfiles())
    } catch (error) {
      notifications.show({ message: errorMessage(error), color: "red", autoClose: false })
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return { profiles, loading, refresh, setProfiles }
}
