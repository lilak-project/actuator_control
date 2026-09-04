import { useState } from "react"
import { AppShell, Badge, Button, Container, Group, Stack, Tabs, Text, Title } from "@mantine/core"
import { Eye, EyeOff, Plug, Settings2 } from "lucide-react"

import { ActuatorPanel } from "@/components/actuator-panel"
import { ConnectPanel } from "@/components/connect-panel"
import { HelpPanel } from "@/components/help-panel"
import { useAction } from "@/hooks/use-action"
import { useLastPositions } from "@/hooks/use-last-positions"
import { useProfiles } from "@/hooks/use-profiles"
import { useStatusStream } from "@/hooks/use-status-stream"
import { useStepNames } from "@/hooks/use-step-names"
import { api } from "@/lib/api"
import { gate, stateLabel, stateTone, stepLabel } from "@/lib/gating"

/** The two tabs that are always there, whatever is connected. */
const CONNECT_TAB = "connect"
const HELP_TAB = "help"

export default function App() {
  const { actuators, live } = useStatusStream()
  const { profiles, refresh, setProfiles } = useProfiles()
  const ips = actuators.map((actuator) => actuator.ip)
  const stepNames = useStepNames(ips)
  const { pending, run } = useAction()

  // Re-read whenever the set of connections changes: disconnecting records a
  // fresh "last left at" that the Connect tab should pick up immediately.
  const lastPositions = useLastPositions(ips.join(","))

  // The reading depth is a property of the operator, not of one axis, so it
  // lives here and every tab follows it.
  const [richView, setRichView] = useState(false)
  const [requestedTab, setRequestedTab] = useState<string | null>(null)

  // Fall back to the Connect tab whenever the requested axis is gone, so the
  // selection follows connections without an extra render pass.
  const active =
    requestedTab &&
    (requestedTab === CONNECT_TAB || requestedTab === HELP_TAB || ips.includes(requestedTab))
      ? requestedTab
      : (ips[0] ?? CONNECT_TAB)

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

  return (
    <AppShell header={{ height: { base: 104, md: 132 } }} padding={0}>
      {/* The header is fixed, so the tabs stay reachable however far you scroll.
          No bottom rule: the tabs are coloured blocks and separate themselves. */}
      <AppShell.Header withBorder={false}>
        <Container h={64}>
          <Group h="100%" justify="space-between" wrap="nowrap">
            <Group gap="md" wrap="nowrap" style={{ minWidth: 0 }}>
              <Title order={1} fz="h3" fw={600} className="app-title">
                Actuator Control
              </Title>
              <LiveBadge live={live} />
            </Group>

            <Button
              variant="default"
              leftSection={richView ? <EyeOff size={18} /> : <Eye size={18} />}
              onClick={() => setRichView((current) => !current)}
            >
              {richView ? "Minimum" : "Rich"}
            </Button>
          </Group>
        </Container>

        <Container>
          <Tabs value={active} onChange={setRequestedTab} variant="pills">
            <Tabs.List>
              <StateTab
                value={CONNECT_TAB}
                active={active === CONNECT_TAB}
                tone="blue"
                name="Connect"
                icon={<Plug size={16} />}
                state={ips.length > 0 ? `${ips.length} connected` : `${profiles.length} saved`}
              />

              {actuators.map((status) => (
                <StateTab
                  key={status.ip}
                  value={status.ip}
                  active={active === status.ip}
                  tone={stateTone(status)}
                  name={status.name}
                  /* The state that used to sit in a badge, plus where the stage
                     is standing -- which survives SV Off and still matters. */
                  state={[stateLabel(status), stepLabel(status, stepNames.forIp(status.ip))]
                    .filter(Boolean)
                    .join(" · ")}
                />
              ))}

              {/* Reference, not an axis: an icon alone, pushed to the far end
                  so it never competes with the tabs you switch between. */}
              <Tabs.Tab
                value={HELP_TAB}
                className="state-tab icon-tab"
                aria-label="Reference — homing speed, alarm codes, manuals"
                style={
                  {
                    marginInlineStart: "auto",
                    "--tt-bg": `var(--mantine-color-gray-${active === HELP_TAB ? 7 : 0})`,
                    "--tt-fg":
                      active === HELP_TAB
                        ? "var(--mantine-color-white)"
                        : "var(--mantine-color-gray-9)",
                    "--tt-bd": `var(--mantine-color-gray-${active === HELP_TAB ? 7 : 2})`,
                    "--tt-hover": `var(--mantine-color-gray-${active === HELP_TAB ? 8 : 1})`,
                  } as React.CSSProperties
                }
              >
                <Settings2 size={20} />
              </Tabs.Tab>
            </Tabs.List>
          </Tabs>
        </Container>
      </AppShell.Header>

      <AppShell.Main>
        <Container py="xl">
          {active === HELP_TAB ? (
            <HelpPanel />
          ) : active === CONNECT_TAB ? (
            <ConnectPanel
              profiles={profiles}
              connectedIps={ips}
              lastPositions={lastPositions}
              onProfilesChanged={setProfiles}
              onConnect={connect}
              pending={pending}
            />
          ) : (
            actuators
              .filter((status) => status.ip === active)
              .map((status) => (
                <ActuatorPanel
                  key={status.ip}
                  status={status}
                  stepNames={stepNames.forIp(status.ip)}
                  onStepNamesChange={(names) => stepNames.update(status.ip, names)}
                  onDisconnect={() => disconnect(status.ip)}
                  disconnecting={pending === `disconnect:${status.ip}`}
                  showAll={richView}
                />
              ))
          )}
        </Container>
      </AppShell.Main>
    </AppShell>
  )
}

/**
 * One tab: the name on top, the state underneath, tinted by that state.
 *
 * The colour is the point -- from across the room the tab row says which axes
 * are live before any of the words are readable. The second line and the tint
 * are ordinary text and background, not badges, so the tab stays a button.
 */
function StateTab({
  value,
  active,
  tone,
  name,
  state,
  icon,
}: {
  value: string
  active: boolean
  tone: "blue" | "teal" | "gray" | "red"
  name: string
  state: string
  icon?: React.ReactNode
}) {
  return (
    <Tabs.Tab
      value={value}
      className="state-tab"
      fz="sm"
      py={6}
      leftSection={icon}
      style={
        {
          "--tt-bg": `var(--mantine-color-${tone}-${active ? 7 : 0})`,
          "--tt-fg": active ? "var(--mantine-color-white)" : `var(--mantine-color-${tone}-9)`,
          "--tt-bd": `var(--mantine-color-${tone}-${active ? 7 : 2})`,
          "--tt-hover": `var(--mantine-color-${tone}-${active ? 8 : 1})`,
        } as React.CSSProperties
      }
    >
      <Stack gap={0} align="flex-start">
        <Text fw={500} className="tab-name">
          {name}
        </Text>
        <Text size="xs" fw={400} className="tab-meta tab-state">
          {state}
        </Text>
      </Stack>
    </Tabs.Tab>
  )
}

function LiveBadge({ live }: { live: boolean }) {
  return (
    <Badge size="md" radius="sm" variant="light" color={live ? "teal" : "red"}>
      {live ? "Live" : "Reconnecting"}
    </Badge>
  )
}
