import { useCallback, useRef, useState } from "react"
import { notifications } from "@mantine/notifications"

import { errorMessage } from "@/lib/api"

/** One toast style for the whole app: quiet on success, sticky on failure. */
export function notify(message: string, kind: "ok" | "error") {
  notifications.show({
    message,
    color: kind === "ok" ? "teal" : "red",
    // Failures are the ones you have to read, so they stay put.
    autoClose: kind === "ok" ? 3000 : false,
    withCloseButton: true,
  })
}

/**
 * Run one command at a time, reporting the outcome as a toast.
 *
 * Hardware commands are slow (Setup waits up to 20 s) and must not be fired
 * twice, so `pending` is the key of the command in flight and callers disable
 * their controls while it is set.
 */
export function useAction() {
  const [pending, setPending] = useState<string | null>(null)
  // A step read can overlap a command; only the last one to finish clears the
  // pending state, so controls don't re-enable while work is still running.
  const inFlight = useRef(0)

  const run = useCallback(
    async (key: string, fn: () => Promise<unknown>, success?: string) => {
      inFlight.current += 1
      setPending(key)
      try {
        await fn()
        if (success) notify(success, "ok")
        return true
      } catch (error) {
        notify(errorMessage(error), "error")
        return false
      } finally {
        inFlight.current -= 1
        if (inFlight.current === 0) setPending(null)
      }
    },
    [],
  )

  return { pending, busy: pending !== null, run }
}
