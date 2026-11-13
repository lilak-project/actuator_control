import { useState } from "react"
import { Button, Table, Text } from "@mantine/core"
import { Notice, Panel, StateDot } from "@neon"
import { notifications } from "@mantine/notifications"
import { Check, ClipboardCopy } from "lucide-react"

import { copyText } from "@/lib/clipboard"
import { ago, mm, stamp } from "@/lib/format"
import { reportStepLabel, rowLabel, rowTone } from "@/lib/gating"
import { api, errorMessage } from "@/lib/api"
import type { Report, ReportRow } from "@/lib/types"

interface OverviewPanelProps {
  report: Report | null
  /** Set when the report could not be read; the last one stays on screen. */
  error: string | null
  loading: boolean
  showAll: boolean
}

/**
 * Every saved actuator on one screen, connected or not.
 *
 * This is the tab the service exists for. An axis nobody holds a session to
 * still has a row here, filled from the control service's last-position
 * record: where it was driven, which step that was, and when. The control
 * screen shows what you can do to an axis; this shows what was done to it.
 */
export function OverviewPanel({ report, error, loading, showAll }: OverviewPanelProps) {
  const rows = report?.actuators ?? []

  return (
    <div className="act-stack">
      {error ? (
        <Notice tone="warn" title="The report could not be read">
          {error}
          {rows.length > 0 ? " — the rows below are the last reading that got through." : ""}
        </Notice>
      ) : null}

      <Panel
        title={<>Saved actuators <span className="faint">· where each axis is, or was last left standing</span></>}
        actions={
          <span className="act-badges">
            {report ? <span className="faint tabular">{stamp(report.at)}</span> : null}
            <CopyReportButton />
          </span>
        }
      >

        {loading && rows.length === 0 ? (
          <Text size="sm" c="dimmed">
            Reading…
          </Text>
        ) : rows.length === 0 ? (
          <Text size="sm" c="dimmed">
            No saved actuators yet.
          </Text>
        ) : (
          <Table.ScrollContainer minWidth={showAll ? 760 : 560}>
            <Table verticalSpacing="sm" horizontalSpacing="md" highlightOnHover>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Actuator</Table.Th>
                  {showAll ? <Table.Th>Address</Table.Th> : null}
                  <Table.Th>State</Table.Th>
                  <Table.Th>Step</Table.Th>
                  <Table.Th ta="right">Position</Table.Th>
                  <Table.Th>Reading</Table.Th>
                  {showAll ? <Table.Th>Alarm</Table.Th> : null}
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {rows.map((row) => (
                  <Row key={row.ip} row={row} showAll={showAll} />
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        )}
      </Panel>

      <span className="faint">
        Monitoring: nothing on this screen moves an axis. Control mode — for a
        portal manager or an admin of this service — homes, energises and moves them.
      </span>
    </div>
  )
}

function Row({ row, showAll }: { row: ReportRow; showAll: boolean }) {
  const tone = rowTone(row)
  const step = reportStepLabel(row)

  return (
    <Table.Tr>
      <Table.Td>
        <Text fw={600} size="sm">
          {row.name || row.ip}
        </Text>
        {!showAll ? (
          <Text size="xs" c="dimmed" className="tabular">
            {row.ip}
          </Text>
        ) : null}
      </Table.Td>

      {showAll ? (
        <Table.Td className="tabular" c="dimmed">
          {row.ip}
        </Table.Td>
      ) : null}

      <Table.Td>
        <StateDot tone={tone} reserve={["Offline", "Alarm", "Not set up", "Servo off", "Moving", "Ready"]}>
          {rowLabel(row)}
        </StateDot>
      </Table.Td>

      <Table.Td>
        <Text size="sm" c={step ? undefined : "dimmed"}>
          {step ?? "not driven yet"}
        </Text>
      </Table.Td>

      <Table.Td className="tabular" ta="right">
        {row.position_mm === null ? (
          <Text span c="dimmed">
            —
          </Text>
        ) : (
          <>
            {mm(row.position_mm)}
            <Text span size="xs" c="dimmed" ml={4}>
              mm
            </Text>
          </>
        )}
      </Table.Td>

      {/* A connected row is being read right now; an offline one is history,
          and saying when it was taken is the difference between the two. */}
      <Table.Td>
        {row.connected ? (
          <Text size="sm" c="teal" fw={500}>
            live
          </Text>
        ) : row.seen_at ? (
          <Text size="sm" c="dimmed" title={stamp(row.seen_at)}>
            {ago(row.seen_at)}
          </Text>
        ) : (
          <Text size="sm" c="dimmed">
            —
          </Text>
        )}
      </Table.Td>

      {showAll ? (
        <Table.Td className="tabular">
          {row.alarms.length === 0 ? (
            <Text span c="dimmed">
              —
            </Text>
          ) : (
            <Text span c="red" fw={600}>
              {row.alarms.join(", ")}
            </Text>
          )}
        </Table.Td>
      ) : null}
    </Table.Tr>
  )
}

/**
 * The same rows in fixed columns, on the clipboard.
 *
 * The control service already renders them that way for pasting into a
 * logbook; this just fetches that and copies it, so a shifter writing up a run
 * never has to retype a position.
 */
function CopyReportButton() {
  const [copied, setCopied] = useState(false)

  const copy = async () => {
    try {
      const text = await api.statusReport()
      if (await copyText(text)) {
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
      } else {
        notifications.show({ color: "red", message: "Could not reach the clipboard." })
      }
    } catch (failure) {
      notifications.show({ color: "red", message: errorMessage(failure) })
    }
  }

  return (
    <Button
      variant="default"
      leftSection={copied ? <Check size={16} /> : <ClipboardCopy size={16} />}
      onClick={() => void copy()}
    >
      {copied ? "Copied" : "Copy for log"}
    </Button>
  )
}
