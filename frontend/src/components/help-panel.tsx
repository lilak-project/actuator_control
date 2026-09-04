import { useEffect, useState } from "react"
import { Anchor, Badge, Code, Group, Paper, Stack, Table, Text } from "@mantine/core"
import { BookText, ExternalLink, FileText } from "lucide-react"

import { api } from "@/lib/api"
import { url } from "@/lib/portal-base"
import type { AlarmReference } from "@/lib/types"

/** How to clear each alarm group, and the colour that says how bad it is. */
const RECOVERY: Record<AlarmReference["recovery"], { label: string; color: string }> = {
  reset: { label: "Stop (RESET)", color: "gray" },
  reset_svon: { label: "Stop → SV On", color: "orange" },
  power_cycle: { label: "Power cycle", color: "red" },
}

/** The homing procedure, in the order it has to be done. */
const HOMING_STEPS: [string, string][] = [
  ["Stop this server", "Two clients writing the same controller is not something it arbitrates."],
  ["Connect the PC", "JXC-W2A-C USB cable. The driver is on the SMC Korea download page."],
  [
    "Run ACT Controller in Normal mode",
    "Easy mode has no parameter window. If it will not connect, check the COM port under Action → System → Setting.",
  ],
  [
    "Upload first",
    "Read what is in the controller now, and Save it to a file. Downloading without uploading writes the blank screen over the controller.",
  ],
  [
    "Lower ORIG speed",
    "In the Return to origin group. The allowed range comes from the actuator, not the controller — check its catalogue.",
  ],
  [
    "Download, then verify",
    "It takes effect immediately and survives power-off. Clear the stage and run Init once. Out of range shows as alarm 049.",
  ],
]

/** The homing parameters worth touching, and what each one actually does. */
const HOMING_PARAMS: [string, string][] = [
  ["ORIG speed", "Speed of the return to origin. The direct answer."],
  ["ORIG ACC/DEC", "Acceleration during homing. Softens the start and the stop."],
  [
    "ORIG mode",
    "1 = push into the mechanical end (default). 2 = stop on the origin sensor, which never hits the end at all.",
  ],
  ["ORIG sensor", "Origin sensor type: 0 disabled, 1 N.O., 2 N.C."],
  ["ORIG limit", "Force used to push against the end when establishing origin."],
  ["ORIG direction", "1 CW, 2 CCW."],
]

const LOG_EXAMPLE = `{"at": "2026-08-29T19:58:45+09:00", "events": ["move 3"],
 "actuator": "Collimator", "ip": "192.168.1.153", "connected": true,
 "servo_on": true, "homed": true, "moving": true, "stopped": false,
 "step": 3, "step_name": "3 cm", "position_mm": 11.4, "alarms": []}`

/** What each field in a log line means. */
const LOG_FIELDS: [string, string][] = [
  ["at", "When the change was seen. Local time, ISO 8601."],
  [
    "events",
    "What changed: connect, disconnect, sv on, sv off, init, move N, settled, stop, alarm N, alarm clear.",
  ],
  ["actuator, ip", "Which axis, by profile name and address."],
  ["connected", "Whether a session was open."],
  ["servo_on", "The SVRE signal — the servo is energised."],
  ["homed", "The origin is established (Init has run)."],
  ["moving", "The BUSY signal — the axis was travelling."],
  ["stopped", "A move was abandoned part-way with Stop, so the axis is between steps."],
  ["step, step_name", "The slot it was sent to, and its label. Null before the axis is driven."],
  ["position_mm", "Position at that instant, in millimetres."],
  ["alarms", "Every non-zero alarm code standing at that instant."],
]

const MANUALS: [string, string, string][] = [
  [
    "Homing speed — full procedure",
    "/docs/init-speed.html",
    "Why the web UI cannot do it, what to check first, and the parameter table (Korean).",
  ],
  [
    "JXC91 Operation Manual",
    "/docs/JXC91_operation_manual_SFOD-OMT0006-G.pdf",
    "SFOD-OMT0006-G. Memory map, alarms, homing, EtherNet/IP objects.",
  ],
  [
    "ACT Controller help",
    "/docs/ACT_Controller_help_JXC-OMU0010-A.pdf",
    "JXC※-OMU0010-A. The setting software used for the procedure above.",
  ],
]

/**
 * The reference tab: the two things you cannot look up from the panel itself.
 *
 * Homing speed lives in a controller parameter that is not on EtherNet/IP, and
 * an alarm code is a number until something tells you what to do about it.
 */
export function HelpPanel() {
  const [alarms, setAlarms] = useState<AlarmReference[]>([])

  useEffect(() => {
    void api
      .listAlarms()
      .then(setAlarms)
      .catch(() => setAlarms([]))
  }, [])

  return (
    <Stack gap="lg">
      <Paper withBorder p="lg">
        <Text fw={600} size="lg">
          Init speed
        </Text>
        <Text size="sm" c="dimmed" mt={2} maw={700}>
          Homing speed is the controller parameter <b>ORIG speed</b>. Only the step data object is
          exposed on EtherNet/IP, so nothing in this app — or any EtherNet/IP client — can change
          it. It takes ACT Controller over the USB cable.
        </Text>
        <Text size="sm" mt="sm" maw={700}>
          Before changing anything: homing accelerates on a trapezoid, so a short traverse never
          reaches ORIG speed while a long one does. The same setting can look very different on two
          runs. Check the distance before you blame the parameter.
        </Text>

        <Stack gap="xs" mt="md">
          {HOMING_STEPS.map(([title, detail], index) => (
            <Group key={title} align="flex-start" gap="sm" wrap="nowrap">
              <Badge variant="light" color="gray" radius="sm" className="tabular">
                {index + 1}
              </Badge>
              <Text size="sm" maw={680}>
                <b>{title}</b> — {detail}
              </Text>
            </Group>
          ))}
        </Stack>

        <Table mt="lg" withTableBorder striped="even" verticalSpacing="xs" horizontalSpacing="md">
          <Table.Thead>
            <Table.Tr>
              <Table.Th w={170}>Parameter</Table.Th>
              <Table.Th>Effect</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {HOMING_PARAMS.map(([name, effect]) => (
              <Table.Tr key={name}>
                <Table.Td>
                  <Text size="sm" fw={500} className="tabular">
                    {name}
                  </Text>
                </Table.Td>
                <Table.Td>
                  <Text size="sm">{effect}</Text>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>

        <Text size="sm" c="dimmed" mt="md" maw={700}>
          With the default ORIG mode the stage is driven deliberately into its mechanical end, so
          clear the path first. Init cannot be skipped either: the encoder is incremental, so the
          origin is lost whenever the controller's 24 V is cut. It survives SV Off, a disconnect and
          a server restart, so once a day is enough.
        </Text>
      </Paper>

      <Paper withBorder p="lg">
        <Text fw={600} size="lg">
          Alarm codes
        </Text>
        <Text size="sm" c="dimmed" mt={2} maw={700}>
          The controller reports up to four at once; they appear under the position readout. Groups
          B and C clear with Stop, D drops the servo so SV On follows, and E cannot be cleared at
          all until the controller's 24 V control power is switched off and on — after which the
          axis needs Init again.
        </Text>

        <Table.ScrollContainer minWidth={640} mt="md">
          <Table striped="even" verticalSpacing="xs" horizontalSpacing="md" withTableBorder>
            <Table.Thead>
              <Table.Tr>
                <Table.Th w={70}>Code</Table.Th>
                <Table.Th w={250}>Name</Table.Th>
                <Table.Th w={160}>Clears with</Table.Th>
                <Table.Th>What to check</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {alarms.map((alarm) => (
                <Table.Tr key={alarm.code}>
                  <Table.Td>
                    <Text className="tabular" fw={600} size="sm">
                      {alarm.code}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm">{alarm.name}</Text>
                  </Table.Td>
                  <Table.Td>
                    <Badge
                      variant="light"
                      radius="sm"
                      color={RECOVERY[alarm.recovery].color}
                      style={{ whiteSpace: "nowrap" }}
                    >
                      {RECOVERY[alarm.recovery].label}
                    </Badge>
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm" c="dimmed">
                      {alarm.hint}
                    </Text>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      </Paper>

      <Paper withBorder p="lg">
        <Text fw={600} size="lg">
          Status files
        </Text>
        <Text size="sm" c="dimmed" mt={2} maw={700}>
          Two of them, and the difference matters: <Code>backend/data/status.json</Code> is the
          present tense — the current state of every profile, overwritten whenever it changes and
          at least once a minute, so its <Code>at</Code> also says the server is alive.{" "}
          <Code>backend/data/status.jsonl</Code> is the history.
        </Text>
        <Text size="sm" mt="md" maw={700}>
          Every change — connect, servo, Init, a move starting and settling, an alarm latching or
          clearing, disconnect — is appended to the log as one labelled JSON object per line, with
          the position at that moment. It keeps running whether or not a browser is open, and
          rotates to <Code>status.jsonl.1</Code> at 5 MB. The snapshot holds the same fields, one
          entry per profile, under <Code>actuators</Code>.
        </Text>

        <Code block mt="sm" style={{ whiteSpace: "pre", overflowX: "auto" }}>
          {LOG_EXAMPLE}
        </Code>

        <Table mt="md" withTableBorder striped="even" verticalSpacing="xs" horizontalSpacing="md">
          <Table.Thead>
            <Table.Tr>
              <Table.Th w={140}>Field</Table.Th>
              <Table.Th>Meaning</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {LOG_FIELDS.map(([field, meaning]) => (
              <Table.Tr key={field}>
                <Table.Td>
                  <Text size="sm" fw={500} className="tabular">
                    {field}
                  </Text>
                </Table.Td>
                <Table.Td>
                  <Text size="sm">{meaning}</Text>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>

        <Group gap="lg" mt="md">
          <Anchor href={url("/api/log.txt?lines=500")} target="_blank" rel="noreferrer" size="sm" fw={500}>
            Last 500 changes, as a table
          </Anchor>
          <Anchor href={url("/api/log?lines=500")} target="_blank" rel="noreferrer" size="sm" fw={500}>
            The same as JSON
          </Anchor>
          <Anchor href={url("/api/report.txt")} target="_blank" rel="noreferrer" size="sm" fw={500}>
            Status right now
          </Anchor>
        </Group>
        <Text size="sm" c="dimmed" mt="sm" maw={700}>
          <Code>ACTUATOR_STATUS_LOG</Code> and <Code>ACTUATOR_STATUS_SNAPSHOT</Code> move either
          file, or switch it off when set to nothing.
        </Text>
      </Paper>

      <Paper withBorder p="lg">
        <Text fw={600} size="lg" mb="md">
          Manuals
        </Text>
        <Stack gap="sm">
          {MANUALS.map(([title, href, detail]) => (
            <Group key={href} align="flex-start" gap="sm" wrap="nowrap">
              <FileText size={18} style={{ marginTop: 2, flexShrink: 0 }} />
              <Stack gap={0}>
                <Anchor href={url(href)} target="_blank" rel="noreferrer" fw={500} size="sm">
                  {title}
                </Anchor>
                <Text size="sm" c="dimmed">
                  {detail}
                </Text>
              </Stack>
            </Group>
          ))}

          <Group align="flex-start" gap="sm" wrap="nowrap">
            <ExternalLink size={18} style={{ marginTop: 2, flexShrink: 0 }} />
            <Stack gap={0}>
              <Anchor
                href="https://www.smckorea.co.kr/homepage/ver3.5/download/manual_controller_JXC1.asp"
                target="_blank"
                rel="noreferrer"
                fw={500}
                size="sm"
              >
                SMC Korea — controller manuals and ACT Controller
              </Anchor>
              <Text size="sm" c="dimmed">
                Where the setting software and the USB driver come from.
              </Text>
            </Stack>
          </Group>

          <Group align="flex-start" gap="sm" wrap="nowrap" mt="xs">
            <BookText size={18} style={{ marginTop: 2, flexShrink: 0 }} />
            <Text size="sm" c="dimmed">
              Both manuals are also in <span className="tabular">docs/</span> as extracted text, so
              they can be grepped.
            </Text>
          </Group>
        </Stack>
      </Paper>
    </Stack>
  )
}
