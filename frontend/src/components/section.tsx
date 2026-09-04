import { Box, Stack, Text } from "@mantine/core"
import type { ReactNode } from "react"

/**
 * A titled block of controls with no border of its own.
 *
 * Everything below the status panel is grouped this way: the heading and the
 * whitespace do the separating, so the page stays free of nested boxes.
 */
export function Section({
  title,
  description,
  children,
}: {
  title: string
  description?: ReactNode
  children: ReactNode
}) {
  return (
    <Box>
      <Text fw={600} size="lg" mb={description ? 2 : "sm"}>
        {title}
      </Text>
      {description ? (
        <Text size="sm" c="dimmed" mb="sm">
          {description}
        </Text>
      ) : null}
      <Stack gap="md">{children}</Stack>
    </Box>
  )
}
