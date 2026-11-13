import { Badge, Group, Table, Text } from "@mantine/core"
import { Panel } from "@neon"

import { ORIGIN_NAME, ORIGIN_STEP } from "@/lib/gating"
import { mm } from "@/lib/format"
import type { StepPosition } from "@/lib/types"

/**
 * The axis's stored step table, read-only.
 *
 * Mode 0 means the slot is unregistered, so it is not a place the axis can be
 * sent; listing all 64 would bury the handful that are real. Minimum shows the
 * registered steps alone, Rich adds the mode column that explains why a slot
 * behaves the way it does.
 */
export function StepTable({
  steps,
  currentStep,
  position,
  showAll,
}: {
  steps: StepPosition[]
  /** Which slot the axis was last driven to, so it can be marked here. */
  currentStep: number | null
  /** Live position, for the distance column. */
  position: number
  showAll: boolean
}) {
  const registered = steps.filter((step) => step.mode !== 0)

  if (registered.length === 0) {
    return (
      <Panel title="Stored steps">
        <span className="faint">No steps are registered on this controller.</span>
      </Panel>
    )
  }

  return (
    <Panel title="Stored steps">
      <Table.ScrollContainer minWidth={420}>
        <Table verticalSpacing="xs" horizontalSpacing="md" highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <Table.Th w={70}>Step</Table.Th>
              <Table.Th>Name</Table.Th>
              <Table.Th ta="right">Position</Table.Th>
              {showAll ? <Table.Th ta="right">From here</Table.Th> : null}
              {showAll ? <Table.Th w={90}>Mode</Table.Th> : null}
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {registered.map((step) => {
              const here = step.number === currentStep
              const name = step.number === ORIGIN_STEP ? ORIGIN_NAME : step.name
              return (
                <Table.Tr key={step.number} className={here ? "act-here" : undefined}>
                  <Table.Td className="tabular">{step.number}</Table.Td>
                  <Table.Td>
                    <Group gap="xs" wrap="nowrap">
                      <Text size="sm" c={name ? undefined : "dimmed"}>
                        {name || "unnamed"}
                      </Text>
                      {here ? (
                        <Badge size="sm" color="teal">
                          here
                        </Badge>
                      ) : null}
                    </Group>
                  </Table.Td>
                  <Table.Td className="tabular" ta="right">
                    {mm(step.position)} mm
                  </Table.Td>
                  {showAll ? (
                    <Table.Td className="tabular" ta="right" c="dimmed">
                      {signed(step.position - position)} mm
                    </Table.Td>
                  ) : null}
                  {showAll ? (
                    <Table.Td>
                      <Text size="sm" c="dimmed">
                        {MODE_NAMES[step.mode] ?? step.mode}
                      </Text>
                    </Table.Td>
                  ) : null}
                </Table.Tr>
              )
            })}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
    </Panel>
  )
}

/** JXC91 §step data: 1 is an ordinary absolute move, 2 a relative one. */
const MODE_NAMES: Record<number, string> = { 1: "absolute", 2: "relative" }

/** A distance that is worth a sign, because it says which way. */
function signed(value: number): string {
  const shown = Math.abs(value) < 0.005 ? 0 : value
  return `${shown > 0 ? "+" : ""}${shown.toFixed(2)}`
}
