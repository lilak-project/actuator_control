import {
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"

import { ORIGIN_NAME, ORIGIN_STEP } from "@/lib/gating"
import type { StepPosition } from "@/lib/types"

/** Everything sits on one horizontal rail; y is a constant, not a measure. */
const RAIL = 0.5

interface PositionTrackProps {
  /** Live position of the axis, in mm. */
  position: number
  /** Commanded position, in mm. */
  target: number
  /** Stored step table, drawn as marks along the rail. */
  steps: StepPosition[]
  /** Top of the axis: the profile limit, or the furthest thing in view. */
  max: number
}

interface Point {
  x: number
  y: number
  step?: StepPosition
}

/**
 * The axis, drawn as the thing it is: a rail from 0 to its maximum.
 *
 * Every stored step is a mark on that rail and the live position rides along
 * it, so "where is it, where can it go, and where is it going" is one glance
 * rather than three readings. A time-series would answer a question nobody
 * asks -- the current value is already printed beside it.
 */
export function PositionTrack({ position, target, steps, max }: PositionTrackProps) {
  // Mode 0 means the slot is unregistered, so it is not a place the axis can
  // be sent -- plotting all 64 would bury the handful that are real.
  const stepPoints: Point[] = steps
    .filter((step) => step.mode !== 0 && step.position <= max)
    .map((step) => ({
      x: step.position,
      y: RAIL,
      step: step.number === ORIGIN_STEP ? { ...step, name: ORIGIN_NAME } : step,
    }))
  const current: Point[] = [{ x: Math.min(position, max), y: RAIL }]

  return (
    <div
      style={{ width: "100%", height: 140 }}
      role="img"
      aria-label={`Axis position ${position.toFixed(2)} of ${max.toFixed(2)} mm`}
    >
      <ResponsiveContainer width="100%" height="100%">
        <ScatterChart margin={{ top: 28, right: 24, bottom: 22, left: 24 }}>
          <XAxis
            type="number"
            dataKey="x"
            domain={[0, max]}
            tickCount={6}
            tickLine={false}
            axisLine={false}
            tick={{ fontSize: 12, fill: "var(--mantine-color-dimmed)" }}
            tickFormatter={(value: number) => `${value}`}
            unit=""
          />
          <YAxis type="number" dataKey="y" domain={[0, 1]} hide />

          {/* The rail itself. */}
          <ReferenceLine
            y={RAIL}
            stroke="var(--mantine-color-gray-3)"
            strokeWidth={6}
            strokeLinecap="round"
          />

          {/* Where it has been told to go, when that is not where it is yet. */}
          {Math.abs(target - position) > 0.05 ? (
            <ReferenceLine
              x={Math.min(target, max)}
              stroke="var(--mantine-color-gray-5)"
              strokeDasharray="3 3"
            />
          ) : null}

          <Scatter
            name="Stored steps"
            data={stepPoints}
            fill="var(--mantine-color-gray-6)"
            shape={<StepMark />}
            isAnimationActive={false}
          />
          <Scatter
            name="Current position"
            data={current}
            shape={<CurrentMark />}
            isAnimationActive={false}
          />

          <Tooltip
            cursor={false}
            isAnimationActive={false}
            content={<StepTooltip />}
          />
        </ScatterChart>
      </ResponsiveContainer>
    </div>
  )
}

interface ShapeProps {
  cx?: number
  cy?: number
  payload?: Point
}

/** A stored step: a notch straddling the rail, labelled when it has a name. */
function StepMark({ cx, cy, payload }: ShapeProps) {
  if (cx === undefined || cy === undefined) return null
  const name = payload?.step?.name
  return (
    <g>
      <rect
        x={cx - 1.5}
        y={cy - 9}
        width={3}
        height={18}
        rx={1.5}
        fill="var(--mantine-color-gray-6)"
      />
      {name ? (
        <text
          x={cx}
          y={cy + 26}
          textAnchor="middle"
          fontSize={11}
          fill="var(--mantine-color-dimmed)"
        >
          {name}
        </text>
      ) : null}
    </g>
  )
}

/** The live position: a filled pointer sitting on the rail. */
function CurrentMark({ cx, cy }: ShapeProps) {
  if (cx === undefined || cy === undefined) return null
  return (
    <g>
      <path
        d={`M ${cx} ${cy - 8} L ${cx - 8} ${cy - 22} L ${cx + 8} ${cy - 22} Z`}
        fill="var(--mantine-color-blue-6)"
      />
      <circle cx={cx} cy={cy} r={7} fill="var(--mantine-color-blue-6)" />
      <circle cx={cx} cy={cy} r={3} fill="var(--mantine-color-white)" />
    </g>
  )
}

interface TooltipProps {
  active?: boolean
  payload?: { payload: Point }[]
}

function StepTooltip({ active, payload }: TooltipProps) {
  const point = payload?.[0]?.payload
  if (!active || !point) return null
  const step = point.step
  return (
    <div
      style={{
        background: "var(--mantine-color-body)",
        border: "1px solid var(--mantine-color-gray-3)",
        borderRadius: "var(--mantine-radius-sm)",
        padding: "4px 10px",
        boxShadow: "var(--mantine-shadow-sm)",
        fontSize: "var(--mantine-font-size-xs)",
        whiteSpace: "nowrap",
      }}
    >
      <span className="tabular" style={{ fontWeight: 600 }}>
        {point.x.toFixed(2)} mm
      </span>
      {step ? (
        <span style={{ marginLeft: 8, color: "var(--mantine-color-dimmed)" }}>
          Step {step.number}
          {step.name ? ` · ${step.name}` : ""}
        </span>
      ) : (
        <span style={{ marginLeft: 8, color: "var(--mantine-color-dimmed)" }}>current</span>
      )}
    </div>
  )
}
