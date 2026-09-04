import { Box, Text } from "@mantine/core"

/** A label above a monospaced value; used for every secondary number. */
export function Readout({
  label,
  value,
  unit,
}: {
  label: string
  value: string
  unit?: string
}) {
  return (
    <Box>
      <Text size="xs" c="dimmed" fw={500}>
        {label}
      </Text>
      <Text className="tabular" size="lg" fw={600} lh={1.2}>
        {value}
        {unit ? (
          <Text span size="sm" c="dimmed" fw={400} ml={4}>
            {unit}
          </Text>
        ) : null}
      </Text>
    </Box>
  )
}
