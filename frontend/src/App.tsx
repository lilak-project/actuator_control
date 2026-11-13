import { useCallback, useState } from "react"
import { Brand, Choice, Screen, Spacer, StateDot, Tabs, ThemeSwitch, type TabItem } from "@neon"

import { ActuatorPanel } from "@/components/actuator-panel"
import { ConnectPanel } from "@/components/connect-panel"
import { HelpPanel } from "@/components/help-panel"
import { HistoryPanel } from "@/components/history-panel"
import { OverviewPanel } from "@/components/overview-panel"
import { useAction } from "@/hooks/use-action"
import { useLastPositions } from "@/hooks/use-last-positions"
import { usePoll } from "@/hooks/use-poll"
import { useProfiles } from "@/hooks/use-profiles"
import { useStatusStream } from "@/hooks/use-status-stream"
import { useStepNames } from "@/hooks/use-step-names"
import { api } from "@/lib/api"
import { gate, stateLabel, stateTone, stepLabel } from "@/lib/gating"

/** The tabs that are always there, whatever is connected. */
const LIST_TAB = "list"
const HISTORY_TAB = "history"
const HELP_TAB = "help"

/** The report is the only live source for the axes nobody is connected to. */
const REPORT_INTERVAL = 3000
/** The log only grows when something happens. */
const LOG_INTERVAL = 10000
/** A portal role change reaches the page within this. */
const ME_INTERVAL = 30000

/** Remembered per browser: a controller who chose to just watch stays watching. */
const MODE_KEY = "actuator.mode"
type Mode = "control" | "monitor"

function savedMode(): Mode {
  try {
    return window.localStorage.getItem(MODE_KEY) === "monitor" ? "monitor" : "control"
  } catch {
    return "control"
  }
}

/**
 * One service, two modes. Control drives the axes; monitoring only watches
 * (what actuator_monitoring used to be). Who may control is the server's call
 * (/api/me, enforced on every write); anyone who may can also step down to
 * monitoring, where no button that moves anything is drawn.
 */
export default function App() {
  const { actuators, live } = useStatusStream()
  const { profiles, refresh, setProfiles } = useProfiles()
  const ips = actuators.map((actuator) => actuator.ip)
  const stepNames = useStepNames(ips)
  const { pending, run } = useAction()

  const me = usePoll(useCallback(() => api.me(), []), ME_INTERVAL)
  const [chosen, setChosen] = useState<Mode>(savedMode)
  const mayControl = me.data?.control ?? false
  const mode: Mode = mayControl ? chosen : "monitor"
  const control = mode === "control"
  const choose = (next: Mode) => {
    setChosen(next)
    try {
      window.localStorage.setItem(MODE_KEY, next)
    } catch {
      /* it just will not be remembered */
    }
  }

  const [logLines, setLogLines] = useState(200)
  const report = usePoll(useCallback(() => api.report(), []), REPORT_INTERVAL)
  const log = usePoll(useCallback(() => api.log(logLines), [logLines]), LOG_INTERVAL, String(logLines))
  // Re-read with every report, so "last left at" follows a move or a disconnect.
  const lastPositions = useLastPositions(ips.join(",") + (report.data?.at ?? ""))

  // The reading depth is a property of the operator, not of one axis.
  const [richView, setRichView] = useState(false)
  const [requestedTab, setRequestedTab] = useState<string | null>(null)

  // Fall back to the list whenever the requested axis is gone, so the
  // selection follows connections without an extra render pass.
  const active =
    requestedTab && ([LIST_TAB, HISTORY_TAB, HELP_TAB].includes(requestedTab) || ips.includes(requestedTab))
      ? requestedTab
      : LIST_TAB

  const connect = (ip: string, name: string) =>
    void run(
      `connect:${ip}`,
      async () => {
        await api.connect(ip, name)
        setRequestedTab(ip)
        await refresh()
      },
      `Connected to ${name}`,
    )

  const disconnect = (ip: string) => {
    const status = actuators.find((actuator) => actuator.ip === ip)
    // Park the servo on the way out, but only when SV Off is a legal command.
    const svOff = status ? gate(status).svoff : false
    void run(`disconnect:${ip}`, () => api.disconnect(ip, svOff), `Disconnected ${ip}`)
  }

  const offline = (report.data?.actuators ?? []).filter((row) => !row.connected).length

  const tabs: TabItem[] = [
    {
      value: LIST_TAB,
      label: control ? "Connect" : "Overview",
      state: `${ips.length} live · ${offline} offline`,
    },
    ...actuators.map((status) => ({
      value: status.ip,
      label: status.name,
      // The state, plus where the stage is standing -- which survives SV Off
      // and still matters.
      state: [stateLabel(status), stepLabel(status, stepNames.forIp(status.ip))].filter(Boolean).join(" · "),
      tone: stateTone(status),
    })),
    { value: HISTORY_TAB, label: "History" },
    { value: HELP_TAB, label: "Reference" },
  ]

  return (
    <Screen
      top={
        <>
          {/* Monitoring is stated, not implied by missing buttons: a screen that
              looks like the control panel must say when it is not one. */}
          <Brand name="Actuator" readOnly={!control} />
          <Tabs items={tabs} value={active} onChange={setRequestedTab} />
          <Spacer />
          {/* The socket, not an axis: a page that stopped updating must say so,
              or a frozen position is read as a still one. */}
          <StateDot tone={live ? "ok" : "warn"} reserve={["live", "reconnecting · numbers frozen"]}>
            {live ? "live" : "reconnecting · numbers frozen"}
          </StateDot>
          {mayControl ? (
            <Choice
              small
              options={[
                { value: "control", label: "Control" },
                { value: "monitor", label: "Monitor" },
              ]}
              value={mode}
              onChange={choose}
            />
          ) : null}
          <Choice
            small
            options={[
              { value: "min", label: "Minimum" },
              { value: "rich", label: "Rich" },
            ]}
            value={richView ? "rich" : "min"}
            onChange={(v) => setRichView(v === "rich")}
          />
          <ThemeSwitch />
        </>
      }
    >
      {active === HELP_TAB ? (
        <HelpPanel />
      ) : active === HISTORY_TAB ? (
        <HistoryPanel
          log={log.data}
          error={log.error}
          loading={log.loading}
          lines={logLines}
          onLinesChange={setLogLines}
          showAll={richView}
        />
      ) : active === LIST_TAB ? (
        control ? (
          <ConnectPanel
            profiles={profiles}
            connectedIps={ips}
            lastPositions={lastPositions}
            onProfilesChanged={setProfiles}
            onConnect={connect}
            pending={pending}
          />
        ) : (
          <OverviewPanel report={report.data} error={report.error} loading={report.loading} showAll={richView} />
        )
      ) : (
        actuators
          .filter((status) => status.ip === active)
          .map((status) => (
            <ActuatorPanel
              key={status.ip}
              status={status}
              control={control}
              last={lastPositions[status.ip]}
              stepNames={stepNames.forIp(status.ip)}
              onStepNamesChange={(names) => stepNames.update(status.ip, names)}
              onDisconnect={() => disconnect(status.ip)}
              disconnecting={pending === `disconnect:${status.ip}`}
              showAll={richView}
            />
          ))
      )}
    </Screen>
  )
}
