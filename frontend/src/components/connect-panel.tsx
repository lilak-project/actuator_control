import { useState } from "react"
import {
  ActionIcon,
  Badge,
  Button,
  Code,
  Group,
  Modal,
  NumberInput,
  Paper,
  Popover,
  Stack,
  Switch,
  Text,
  TextInput,
} from "@mantine/core"
import { ClipboardList, Pencil, Plug, Plus, Trash2 } from "lucide-react"

import { notify, useAction } from "@/hooks/use-action"
import { api } from "@/lib/api"
import { copyText } from "@/lib/clipboard"
import { describeLastPosition } from "@/lib/format"
import type { LastPosition, Profile } from "@/lib/types"

interface Draft {
  name: string
  ip: string
  limitEnabled: boolean
  maxPosition: number | string
  /** IP of the profile being edited; empty when adding a new one. */
  editing: string
}

const BLANK: Draft = { name: "", ip: "", limitEnabled: false, maxPosition: "", editing: "" }

interface ConnectPanelProps {
  profiles: Profile[]
  connectedIps: string[]
  lastPositions: Record<string, LastPosition>
  onProfilesChanged: (profiles: Profile[]) => void
  onConnect: (ip: string, name: string) => void
  /** Key of the command in flight anywhere in the app, or null. */
  pending: string | null
}

/**
 * The Connect tab: every saved actuator, connectable in one click, and the
 * profile settings that govern it.
 *
 * A profile's IP is its identity, so it is fixed once saved -- changing it
 * would silently create a second profile instead of renaming this one.
 */
export function ConnectPanel({
  profiles,
  connectedIps,
  lastPositions,
  onProfilesChanged,
  onConnect,
  pending,
}: ConnectPanelProps) {
  const { busy, pending: localPending, run } = useAction()
  const [draft, setDraft] = useState<Draft>(BLANK)
  // Deleting a profile is not undoable, so it asks first -- as the original did.
  const [confirming, setConfirming] = useState<string | null>(null)
  // Held only when copying failed, so the text can still be selected by hand.
  const [report, setReport] = useState<string | null>(null)
  const blocked = busy || pending !== null

  // One line per profile, connected or not -- what goes in the beamline log.
  // The toast is raised here rather than by `run`, because a refused clipboard
  // is not a failure and must not be reported as a copy that worked.
  const copyStatus = () =>
    run("report", async () => {
      const text = await api.statusReport()
      if (await copyText(text)) notify("Status copied", "ok")
      else setReport(text)
    })

  const save = () =>
    run(
      "save",
      async () => {
        const ip = draft.ip.trim()
        if (!ip) throw new Error("IP address is required")
        onProfilesChanged(
          await api.saveProfile({
            name: draft.name.trim() || ip,
            ip,
            position_limit_enabled: draft.limitEnabled,
            max_position: draft.limitEnabled ? Number(draft.maxPosition) || 0 : null,
          }),
        )
        setDraft(BLANK)
      },
      draft.editing ? "Profile updated" : "Profile created",
    )

  const remove = (profile: Profile) =>
    run(
      "delete",
      async () => {
        onProfilesChanged(await api.deleteProfile(profile.ip))
        setConfirming(null)
        setDraft((current) => (current.editing === profile.ip ? BLANK : current))
      },
      `Deleted ${profile.name}`,
    )

  return (
    <Stack gap="lg">
      <Paper withBorder p="lg">
        <Group justify="space-between" align="center" mb="md" wrap="wrap">
          <Text fw={600} size="lg">
            Actuators
          </Text>
          <Button
            variant="default"
            leftSection={<ClipboardList size={18} />}
            loading={localPending === "report"}
            onClick={() => void copyStatus()}
          >
            Copy status
          </Button>
        </Group>

        {profiles.length === 0 ? (
          <Text c="dimmed" py="lg">
            No profiles yet. Add one below — the actuator's name and IP address is all it takes.
          </Text>
        ) : (
          <Stack gap="xs">
            {profiles.map((profile) => {
              const connected = connectedIps.includes(profile.ip)
              const last = lastPositions[profile.ip]
              return (
                <Paper key={profile.ip} withBorder p="sm" radius="md">
                  <Group justify="space-between" wrap="wrap" gap="sm">
                    <Stack gap={0} style={{ minWidth: 0, flex: "1 1 220px" }}>
                      <Group gap="xs" wrap="nowrap">
                        <Text fw={500} truncate>
                          {profile.name}
                        </Text>
                        <Text className="tabular" size="sm" c="dimmed">
                          {profile.ip}
                        </Text>
                      </Group>
                      {/* Where the stage was left standing, so the beamline
                          state is legible with nothing connected. */}
                      <Text size="xs" c="dimmed">
                        {last ? describeLastPosition(last) : "Never connected"}
                      </Text>
                    </Stack>

                    <Group gap="xs" wrap="nowrap">
                      <Badge variant="light" color="gray" className="tabular">
                        {profile.position_limit_enabled
                          ? `≤ ${profile.max_position?.toFixed(2)} mm`
                          : "No limit"}
                      </Badge>
                      <ActionIcon
                        variant="subtle"
                        color="gray"
                        size="lg"
                        aria-label={`Edit ${profile.name}`}
                        disabled={blocked}
                        onClick={() =>
                          setDraft({
                            name: profile.name,
                            ip: profile.ip,
                            limitEnabled: profile.position_limit_enabled,
                            maxPosition: profile.max_position ?? "",
                            editing: profile.ip,
                          })
                        }
                      >
                        <Pencil size={18} />
                      </ActionIcon>
                      <Popover
                        opened={confirming === profile.ip}
                        onChange={(open) => setConfirming(open ? profile.ip : null)}
                        position="bottom-end"
                        withArrow
                        shadow="md"
                      >
                        <Popover.Target>
                          <ActionIcon
                            variant="subtle"
                            color="red"
                            size="lg"
                            aria-label={`Delete ${profile.name}`}
                            disabled={blocked || connected}
                            onClick={() =>
                              setConfirming((current) =>
                                current === profile.ip ? null : profile.ip,
                              )
                            }
                          >
                            <Trash2 size={18} />
                          </ActionIcon>
                        </Popover.Target>
                        <Popover.Dropdown p="md">
                          <Text size="sm" mb="sm">
                            Delete <b>{profile.name}</b>?
                          </Text>
                          <Group gap="xs" justify="flex-end">
                            <Button variant="default" onClick={() => setConfirming(null)}>
                              Cancel
                            </Button>
                            <Button color="red" onClick={() => void remove(profile)}>
                              Delete
                            </Button>
                          </Group>
                        </Popover.Dropdown>
                      </Popover>

                      <Button
                        leftSection={<Plug size={18} />}
                        disabled={blocked || connected}
                        loading={pending === `connect:${profile.ip}`}
                        onClick={() => onConnect(profile.ip, profile.name)}
                      >
                        {connected ? "Connected" : "Connect"}
                      </Button>
                    </Group>
                  </Group>
                </Paper>
              )
            })}
          </Stack>
        )}
      </Paper>

      <Paper withBorder p="lg">
        <Text fw={600} size="lg" mb="md">
          {draft.editing ? `Editing ${draft.editing}` : "New profile"}
        </Text>

        <Stack gap="md">
          <Group grow align="flex-start">
            <TextInput
              label="Name"
              placeholder="e.g. Collimator"
              autoComplete="off"
              value={draft.name}
              onChange={(event) =>
                setDraft((current) => ({ ...current, name: event.currentTarget.value }))
              }
            />
            <TextInput
              label="IP address"
              placeholder="192.168.1.150"
              autoComplete="off"
              inputMode="decimal"
              classNames={{ input: "tabular" }}
              disabled={Boolean(draft.editing)}
              value={draft.ip}
              onChange={(event) =>
                setDraft((current) => ({ ...current, ip: event.currentTarget.value }))
              }
            />
          </Group>

          <Group align="flex-end" gap="md">
            <Switch
              size="lg"
              mb={8}
              label="Limit position"
              checked={draft.limitEnabled}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  limitEnabled: event.currentTarget.checked,
                }))
              }
            />
            <NumberInput
              label="Maximum"
              w={200}
              min={0}
              max={999}
              step={0.01}
              decimalScale={2}
              suffix=" mm"
              classNames={{ input: "tabular" }}
              disabled={!draft.limitEnabled}
              value={draft.maxPosition}
              onChange={(value) => setDraft((current) => ({ ...current, maxPosition: value }))}
            />
          </Group>

          <Group justify="space-between">
            <Button
              variant="subtle"
              color="gray"
              leftSection={<Plus size={18} />}
              disabled={blocked || !draft.editing}
              onClick={() => setDraft(BLANK)}
            >
              New profile
            </Button>
            <Button disabled={blocked || !draft.ip.trim()} onClick={() => void save()}>
              {draft.editing ? "Save changes" : "Create profile"}
            </Button>
          </Group>
        </Stack>
      </Paper>

      {/* Plain http has no clipboard API, so when the copy is refused the text
          is shown instead rather than silently doing nothing. */}
      <Modal
        opened={report !== null}
        onClose={() => setReport(null)}
        title="Current status"
        size="xl"
        radius="lg"
        padding="lg"
      >
        <Text size="sm" c="dimmed" mb="sm">
          This browser would not let the page write to the clipboard. Select the text below, or
          open <Code>/api/report.txt</Code>.
        </Text>
        <Code block style={{ whiteSpace: "pre", overflowX: "auto" }}>
          {report}
        </Code>
      </Modal>
    </Stack>
  )
}
