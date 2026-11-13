import { Badge, Group, Table, Text } from "@mantine/core"
import { Choice, Notice, Panel } from "@neon"

import { clock, mm, stamp } from "@/lib/format"
import { reportStepLabel } from "@/lib/gating"
import type { LogRecord, LogResponse } from "@/lib/types"

interface HistoryPanelProps {
  log: LogResponse | null
  error: string | null
  loading: boolean
  /** How many lines to ask the control service for. */
  lines: number
  onLinesChange: (lines: number) => void
  showAll: boolean
}

/**
 * What the axes have been doing, newest first.
 *
 * The control service writes a line whenever an axis changes -- a move, an
 * Init, a servo going off, an alarm latching -- and this is that file, read
 * back. It is the history behind the overview's "last left at": the overview
 * says where an axis ended up, this says how it got there and when.
 */
export function HistoryPanel({
  log,
  error,
  loading,
  lines,
  onLinesChange,
  showAll,
}: HistoryPanelProps) {
  // The file is oldest-first, which is right for appending and wrong for
  // reading: what happened last is what you came to see.
  const records = [...(log?.records ?? [])].reverse()

  return (
    <div className="act-stack">
      {error ? (
        <Notice tone="warn" title="The log could not be read">
          {error}
        </Notice>
      ) : null}

      {log && !log.enabled ? (
        <Notice tone="info" title="The status log is switched off">
          This service is running with ACTUATOR_STATUS_LOG empty, so
          nothing is being recorded. The overview still shows each axis's last
          position — that record is kept separately.
        </Notice>
      ) : null}

      <Panel
        title={<>Movement history <span className="faint">· newest first</span></>}
        actions={
          <Choice
            small
            value={lines}
            onChange={onLinesChange}
            options={[50, 200, 1000].map((n) => ({ value: n, label: `${n} lines` }))}
          />
        }
      >

        {loading && records.length === 0 ? (
          <Text size="sm" c="dimmed">
            Reading…
          </Text>
        ) : records.length === 0 ? (
          <Text size="sm" c="dimmed">
            Nothing logged yet.
          </Text>
        ) : (
          <Table.ScrollContainer minWidth={showAll ? 780 : 560}>
            <Table verticalSpacing="xs" horizontalSpacing="md" highlightOnHover>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th w={showAll ? 150 : 90}>Time</Table.Th>
                  <Table.Th>Actuator</Table.Th>
                  <Table.Th>What happened</Table.Th>
                  <Table.Th>Step</Table.Th>
                  <Table.Th ta="right">Position</Table.Th>
                  {showAll ? <Table.Th>Alarm</Table.Th> : null}
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {records.map((record, index) => (
                  <Line
                    key={`${record.at}-${record.ip}-${index}`}
                    record={record}
                    showAll={showAll}
                  />
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        )}
      </Panel>

      {log?.file ? (
        <Text size="sm" c="dimmed">
          Written as JSON Lines to{" "}
          <Text span className="tabular">
            {log.file}
          </Text>
          .
        </Text>
      ) : null}
    </div>
  )
}

function Line({ record, showAll }: { record: LogRecord; showAll: boolean }) {
  const step = reportStepLabel(record)

  return (
    <Table.Tr>
      <Table.Td className="tabular" c="dimmed">
        {showAll ? stamp(record.at) : clock(record.at)}
      </Table.Td>
      <Table.Td>
        <Text size="sm" fw={500}>
          {record.actuator || record.ip}
        </Text>
      </Table.Td>
      <Table.Td>
        <Group gap={6} wrap="wrap">
          {(record.events ?? []).map((event) => (
            <Badge key={event} size="sm" color={eventTone(event)}>
              {event}
            </Badge>
          ))}
        </Group>
      </Table.Td>
      <Table.Td>
        <Text size="sm" c={step ? undefined : "dimmed"}>
          {step ?? "—"}
        </Text>
      </Table.Td>
      <Table.Td className="tabular" ta="right">
        {record.position_mm === null || record.position_mm === undefined ? (
          <Text span c="dimmed">
            —
          </Text>
        ) : (
          mm(record.position_mm)
        )}
      </Table.Td>
      {showAll ? (
        <Table.Td className="tabular">
          {(record.alarms ?? []).length === 0 ? (
            <Text span c="dimmed">
              —
            </Text>
          ) : (
            <Text span c="red" fw={600}>
              {record.alarms.join(", ")}
            </Text>
          )}
        </Table.Td>
      ) : null}
    </Table.Tr>
  )
}

/**
 * The colour of one event word.
 *
 * A move is the thing this screen is scanned for, so it is the one that is
 * tinted; faults are red, the rest stay quiet so the moves stand out.
 */
function eventTone(event: string): string {
  if (event.startsWith("alarm") && event !== "alarm clear") return "red"
  if (event.startsWith("move")) return "blue"
  if (event === "stop") return "orange"
  if (event === "init" || event === "sv on") return "teal"
  return "gray"
}
