import { useCallback, useEffect, useState } from "react"
import {
  ActionIcon,
  Button,
  Collapse,
  Group,
  Input,
  NumberInput,
  Popover,
  SimpleGrid,
  Stack,
  Switch,
  Text,
  TextInput,
  Tooltip,
  UnstyledButton,
} from "@mantine/core"
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  OctagonX,
  Play,
  Save,
  Trash2,
} from "lucide-react"
import { Panel } from "@neon"

import { useAction } from "@/hooks/use-action"
import { api } from "@/lib/api"
import { ORIGIN_NAME, ORIGIN_STEP, type Gate } from "@/lib/gating"
import type { ActuatorStatus, StepData, StepNames, StepPosition } from "@/lib/types"

const STEP_MAX = 63

/** Slot 0 is the reserved Init entry; the operator's own steps start at 1. */
const FIRST_USER_STEP = 1

/** Square, and as tall as a size-md input, so the row reads as one control. */
const STEP_ARROW = 36

interface FieldSpec {
  key: keyof StepData
  label: string
  unit?: string
  min: number
  max: number
  decimals: number
}

/** The eleven values behind "Advanced"; Position is handled on its own above. */
const ADVANCED: FieldSpec[] = [
  { key: "mode", label: "Mode", min: 0, max: 2, decimals: 0 },
  { key: "speed", label: "Speed", unit: "mm/s", min: 0, max: 999, decimals: 0 },
  { key: "accel", label: "Accel", unit: "mm/s²", min: 0, max: 9999, decimals: 0 },
  { key: "decel", label: "Decel", unit: "mm/s²", min: 0, max: 9999, decimals: 0 },
  { key: "push", label: "Push", unit: "%", min: 0, max: 100, decimals: 0 },
  { key: "trig", label: "Trigger", unit: "%", min: 0, max: 100, decimals: 0 },
  { key: "p_speed", label: "Push speed", unit: "mm/s", min: 0, max: 100, decimals: 0 },
  { key: "m_force", label: "Move force", unit: "%", min: 0, max: 100, decimals: 0 },
  { key: "area1", label: "Area 1", unit: "mm", min: 0, max: 999, decimals: 2 },
  { key: "area2", label: "Area 2", unit: "mm", min: 0, max: 999, decimals: 2 },
  { key: "width", label: "Width", unit: "mm", min: 0, max: 999, decimals: 2 },
]

const ALL_KEYS: (keyof StepData)[] = ["pos", ...ADVANCED.map((field) => field.key)]

type FormValues = Record<keyof StepData, number>

const EMPTY: FormValues = Object.fromEntries(ALL_KEYS.map((k) => [k, 0])) as FormValues

/**
 * What a brand-new step starts as.
 *
 * An unregistered slot reads back as zeros, which is not a step anyone would
 * want to run; these are the values a new stop is expected to be built from.
 */
const NEW_STEP: FormValues = {
  mode: 1,
  speed: 5,
  pos: 0,
  accel: 3000,
  decel: 3000,
  push: 0,
  trig: 0,
  p_speed: 5,
  m_force: 100,
  area1: 0,
  area2: 0,
  width: 0.5,
}

/** What was last read from (or written to) the controller, for change detection. */
interface Loaded {
  values: FormValues
  name: string
}

interface MovePanelProps {
  status: ActuatorStatus
  gate: Gate
  /** The whole step table, slot 0 included. */
  steps: StepPosition[]
  onStepNamesChange: (names: StepNames) => void
  /** Reading depth, chosen once in the header and shared by every tab. */
  showAll: boolean
  onStepsChanged: () => void
}

/**
 * Choose a step, edit it, drive to it.
 *
 * Reading is automatic -- selecting a slot loads it -- and Save writes the
 * position and the name together, so it stays disabled until something has
 * actually changed. The selector stops at the last registered slot; New Step
 * opens the next one, which becomes real only once it is saved.
 */
export function MovePanel({
  status,
  gate,
  steps,
  onStepNamesChange,
  onStepsChanged,
  showAll,
}: MovePanelProps) {
  const { pending, busy, run } = useAction()
  const registered = steps
    .filter((step) => step.mode !== 0 && step.number >= FIRST_USER_STEP)
    .map((step) => step.number)
  const highestRegistered = registered.length > 0 ? Math.max(...registered) : 0
  const originRegistered = steps.some(
    (step) => step.number === ORIGIN_STEP && step.mode !== 0,
  )
  // The selector always reaches exactly one slot past the registered range.
  // That slot is the new step: fill it in and Save, and it becomes real.
  const selectorMax = Math.min(Math.max(highestRegistered + 1, FIRST_USER_STEP), STEP_MAX)

  // Open on the step the axis is parked at: that is the one the operator is
  // most likely to want to inspect or nudge. A -1 (stopped between steps) is
  // a report, not a slot, so it falls back to 0.
  const [stepNumber, setStepNumber] = useState(
    Math.max(ORIGIN_STEP, status.last_step_number ?? FIRST_USER_STEP),
  )
  const [form, setForm] = useState<FormValues>(EMPTY)
  const [loaded, setLoaded] = useState<Loaded>({ values: EMPTY, name: "" })
  const [name, setName] = useState("")
  const [advancedOpen, setAdvancedOpen] = useState(showAll)
  const [fullEdit, setFullEdit] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  const isOrigin = stepNumber === ORIGIN_STEP
  const isNew = stepNumber > highestRegistered
  const posMax = status.position_limit_enabled ? (status.max_position ?? 999) : 999

  const apply = useCallback((values: FormValues, stepName: string) => {
    setForm(values)
    setName(stepName)
    setLoaded({ values, name: stepName })
  }, [])

  const loadStep = useCallback(
    (target: number) =>
      run("read", async () => {
        const step = await api.readStep(status.ip, target)
        // Mode 0 is an unregistered slot: offer the preset rather than zeros.
        const values =
          step.mode === 0
            ? { ...NEW_STEP }
            : (Object.fromEntries(ALL_KEYS.map((k) => [k, step[k]])) as FormValues)
        apply(values, step.name)
      }),
    [apply, run, status.ip],
  )

  // Rich is the "show me everything" reading depth, so it opens Advanced too.
  // It is still a toggle: switching modes sets it, it does not lock it.
  useEffect(() => {
    setAdvancedOpen(showAll)
  }, [showAll])

  // Selecting a slot loads it; that is what the Read button used to be for.
  useEffect(() => {
    void loadStep(stepNumber)
  }, [loadStep, stepNumber])

  // A delete shortens the table, so the selection can fall off the end.
  useEffect(() => {
    setStepNumber((current) => Math.min(current, selectorMax))
  }, [selectorMax])

  // The Init entry is fixed: its label never comes from the name store.
  const displayName = isOrigin ? ORIGIN_NAME : name

  // Saving is only meaningful when something differs from what is stored --
  // except on a brand new slot, where saving is what registers it.
  const changed =
    isNew || name !== loaded.name || ALL_KEYS.some((key) => form[key] !== loaded.values[key])

  const save = () =>
    run(
      "save",
      async () => {
        // Registering a new slot has to write the whole preset; limited mode
        // would keep the empty slot's accel, decel and forces instead.
        const step = await api.writeStep(
          status.ip,
          stepNumber,
          form as StepData,
          !fullEdit && !isNew,
        )
        apply(Object.fromEntries(ALL_KEYS.map((k) => [k, step[k]])) as FormValues, name)
        onStepNamesChange(await api.writeStepName(status.ip, stepNumber, name))
        onStepsChanged()
      },
      `Step ${stepNumber} saved`,
    )

  const stop = () =>
    run("stop", () => api.command(status.ip, "reset"), "Stopped — pick a step and move again")

  const move = () =>
    run(
      "move",
      () => api.command(status.ip, "move", { step: stepNumber }),
      `Moved to step ${stepNumber}${name ? ` — ${name}` : ""}`,
    )

  const remove = () =>
    run(
      "delete",
      async () => {
        await api.deleteStep(status.ip, stepNumber)
        setConfirmingDelete(false)
        onStepNamesChange(await api.readStepNames(status.ip))
        onStepsChanged()
        // The slot number has not changed, so nothing else reloads it -- but
        // what it holds has: either the step that moved down into it, or
        // nothing at all. Leaving the deleted step's name in the field is how
        // you save it straight back onto the wrong slot.
        await loadStep(stepNumber)
      },
      `Step ${stepNumber} deleted — later steps moved down`,
    )

  const selectStep = (value: number) =>
    setStepNumber(Math.min(Math.max(ORIGIN_STEP, value), selectorMax))

  /**
   * Why Move is unavailable, most immediate reason first.
   *
   * Unsaved edits block it on purpose: the controller would drive to the
   * stored position, not the one on screen, which is the worst kind of
   * surprise on a beamline.
   */
  const moveBlocked =
    changed && !isOrigin
      ? isNew
        ? "This step is not registered yet — press Save first"
        : "Unsaved changes — press Save first"
      : isOrigin && !originRegistered
        ? "Step 0 is not registered on the controller"
        : gate.moveBlockedReason

  const deleteBlocked = busy || !gate.editStep || isNew || isOrigin

  const set = (key: keyof StepData, value: string | number) =>
    setForm((current) => ({ ...current, [key]: Number(value) || 0 }))

  return (
    <Panel title="Steps">
      <Stack gap="md">
        <Group align="flex-start" gap="md" wrap="wrap">
          {/* Full-height arrows instead of the stacked spinner: stepping
              through the table is the common case, and a 42 px target is one
              you can hit without looking. */}
          <Input.Wrapper
            // "(6)" is how many steps are stored, not the highest number.
            label={`Step (${registered.length})${isNew && !isOrigin ? " · new" : ""}`}
          >
            <Group gap={6} wrap="nowrap">
              <ActionIcon
                variant="default"
                w={STEP_ARROW}
                h={STEP_ARROW}
                
                aria-label="Previous step"
                disabled={busy || stepNumber <= ORIGIN_STEP}
                onClick={() => selectStep(stepNumber - 1)}
              >
                <ChevronLeft size={18} />
              </ActionIcon>
              <NumberInput
                w={86}
                min={ORIGIN_STEP}
                max={selectorMax}
                clampBehavior="strict"
                allowDecimal={false}
                hideControls
                disabled={busy}
                value={stepNumber}
                onChange={(value) =>
                  // Clearing the field yields "", which Number() turns into NaN.
                  selectStep(Number.isFinite(Number(value)) ? Number(value) : ORIGIN_STEP)
                }
                classNames={{ input: "tabular" }}
                styles={{ input: { textAlign: "center" } }}
              />
              <ActionIcon
                variant="default"
                w={STEP_ARROW}
                h={STEP_ARROW}
                
                aria-label="Next step"
                disabled={busy || stepNumber >= selectorMax}
                onClick={() => selectStep(stepNumber + 1)}
              >
                <ChevronRight size={18} />
              </ActionIcon>
            </Group>
          </Input.Wrapper>
          <TextInput
            label="Name"
            // Capped: without a card around it the field would otherwise run
            // the full width of the page.
            style={{ flex: "1 1 200px", maxWidth: 380 }}
            placeholder="e.g. Plastic, 2 cm, Blank"
            autoComplete="off"
            disabled={busy || isOrigin}
            value={displayName}
            onChange={(event) => setName(event.currentTarget.value)}
          />
          <NumberInput
            label="Position"
            w={190}
            min={0}
            max={posMax}
            step={0.01}
            decimalScale={2}
            fixedDecimalScale
            clampBehavior="strict"
            disabled={busy || isOrigin}
            value={form.pos}
            onChange={(value) => set("pos", value)}
            suffix=" mm"
            classNames={{ input: "tabular" }}
          />
        </Group>

        <Group gap="md" wrap="wrap">
          <MoveButton
            disabled={busy || !gate.move || !!moveBlocked}
            reason={moveBlocked}
            loading={pending === "move"}
            onClick={move}
          />
          <Tooltip
            label="Stop the move, discard the remaining travel, and clear resettable alarms. The axis is then between steps, so pick one and move again."
            withArrow
            multiline
            w={280}
          >
            <Button
              color="red"
              leftSection={<OctagonX size={16} />}
              loading={pending === "stop"}
              disabled={busy || !gate.stop}
              onClick={stop}
            >
              Stop
            </Button>
          </Tooltip>
          <Button
            variant="default"
            leftSection={<Save size={16} />}
            loading={pending === "save"}
            disabled={busy || !gate.editStep || !changed || isOrigin}
            onClick={save}
          >
            Save
          </Button>
          <Popover
            opened={confirmingDelete}
            onChange={setConfirmingDelete}
            position="bottom-end"
            withArrow
            shadow="md"
          >
            <Popover.Target>
              <Button
                variant="default"
                // Only colour it while it can actually be pressed: a red label
                // on a greyed-out button reads as available.
                c={deleteBlocked ? undefined : "red"}
                leftSection={<Trash2 size={16} />}
                loading={pending === "delete"}
                disabled={deleteBlocked}
                onClick={() => setConfirmingDelete((open) => !open)}
              >
                Delete
              </Button>
            </Popover.Target>
            <Popover.Dropdown p="md">
              <Text size="sm" mb="sm" maw={320}>
                Delete step {stepNumber}
                {name ? ` · ${name}` : ""}?
                {stepNumber < highestRegistered
                  ? ` Steps ${stepNumber + 1}–${highestRegistered} move down one.`
                  : ""}
              </Text>
              <Group gap="xs" justify="flex-end">
                <Button variant="default" onClick={() => setConfirmingDelete(false)}>
                  Cancel
                </Button>
                <Button color="red" onClick={remove}>
                  Delete
                </Button>
              </Group>
            </Popover.Dropdown>
          </Popover>
        </Group>

        <Stack gap="xs">
          <UnstyledButton onClick={() => setAdvancedOpen((open) => !open)}>
            <Group gap={6}>
              {advancedOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
              <Text size="sm" fw={500} c="dimmed">
                Advanced — mode, speed, acceleration, AREA window
              </Text>
            </Group>
          </UnstyledButton>

          <Collapse expanded={advancedOpen}>
            <Stack gap="md" pt="xs">
              <Switch
                checked={fullEdit}
                disabled={busy}
                onChange={(event) => setFullEdit(event.currentTarget.checked)}
                label="Full edit"
                description="Off: saving keeps every stored value and forces an absolute move at 5 mm/s."
              />
              <SimpleGrid cols={{ base: 2, sm: 3, lg: 4 }} spacing="md">
                {ADVANCED.map((field) => (
                  <NumberInput
                    key={field.key}
                    label={field.unit ? `${field.label} (${field.unit})` : field.label}
                    size="sm"
                    min={field.min}
                    max={field.max}
                    step={field.decimals ? 0.01 : 1}
                    decimalScale={field.decimals}
                    allowDecimal={field.decimals > 0}
                    clampBehavior="strict"
                    disabled={busy || !fullEdit}
                    value={form[field.key]}
                    onChange={(value) => set(field.key, value)}
                    classNames={{ input: "tabular" }}
                  />
                ))}
              </SimpleGrid>
            </Stack>
          </Collapse>
        </Stack>
      </Stack>
    </Panel>
  )
}

function MoveButton({
  disabled,
  reason,
  loading,
  onClick,
}: {
  disabled: boolean
  reason: string | null
  loading: boolean
  onClick: () => void
}) {
  const button = (
    <Button variant="default" leftSection={<Play size={16} />} loading={loading} disabled={disabled} onClick={onClick}>
      Move
    </Button>
  )

  // A disabled button cannot say why on its own, and "why is Move greyed out"
  // is the question this UI gets asked most.
  if (!reason) return button
  return (
    <Tooltip label={reason} withArrow multiline w={280}>
      <div>{button}</div>
    </Tooltip>
  )
}
