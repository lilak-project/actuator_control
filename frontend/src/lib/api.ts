import type {
  ActuatorStatus,
  AlarmReference,
  CommandName,
  LogResponse,
  Me,
  Profile,
  Report,
  StepData,
  StepNames,
  StepPosition,
  StepResponse,
} from "./types"

import { url } from "@/lib/portal-base"

/** Error carrying the backend's message so the UI can show it verbatim. */
export class ApiError extends Error {
  readonly status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = "ApiError"
    this.status = status
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url(path), {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  })

  if (!response.ok) {
    throw new ApiError(await readErrorMessage(response), response.status)
  }
  if (response.status === 204) {
    return undefined as T
  }
  return (await response.json()) as T
}

async function readErrorMessage(response: Response): Promise<string> {
  try {
    const body = await response.json()
    // FastAPI puts a string in `detail` for HTTPException and a list for
    // request-validation failures.
    if (typeof body?.detail === "string") return body.detail
    if (Array.isArray(body?.detail)) {
      return body.detail.map((item: { msg?: string }) => item.msg ?? "Invalid value").join("; ")
    }
  } catch {
    /* fall through to the status text */
  }
  return response.statusText || `Request failed (${response.status})`
}

const json = (body: unknown): RequestInit => ({ body: JSON.stringify(body) })

export const api = {
  /** Static: answers with nothing connected, so the help screen always works. */
  listAlarms: () => request<AlarmReference[]>("/api/reference/alarms"),

  /** Fixed-column status of every profile, for the operations log. */
  statusReport: async (): Promise<string> => {
    const response = await fetch(url("/api/report.txt"))
    if (!response.ok) {
      throw new ApiError(await readErrorMessage(response), response.status)
    }
    return response.text()
  },

  listProfiles: () => request<Profile[]>("/api/profiles"),

  saveProfile: (profile: Profile) =>
    request<Profile[]>("/api/profiles", { method: "PUT", ...json(profile) }),

  deleteProfile: (ip: string) =>
    request<Profile[]>(`/api/profiles/${encodeURIComponent(ip)}`, { method: "DELETE" }),

  /** Who is looking, and whether they may control. */
  me: () => request<Me>("/api/me"),

  /** One row per saved actuator, connected or not -- the overview. */
  report: () => request<Report>("/api/report"),

  /** The tail of the status log, oldest first. */
  log: (lines = 200) => request<LogResponse>(`/api/log?lines=${lines}`),

  listActuators: () => request<ActuatorStatus[]>("/api/actuators"),

  connect: (ip: string, name = "") =>
    request<ActuatorStatus>("/api/actuators", { method: "POST", ...json({ ip, name }) }),

  disconnect: (ip: string, svOff: boolean) =>
    request<void>(
      `/api/actuators/${encodeURIComponent(ip)}?sv_off=${svOff ? "true" : "false"}`,
      { method: "DELETE" },
    ),

  command: (ip: string, command: CommandName, extra: { step?: number; on?: boolean } = {}) =>
    request<ActuatorStatus>(`/api/actuators/${encodeURIComponent(ip)}/command`, {
      method: "POST",
      ...json({ command, ...extra }),
    }),

  /** Every stored step position, for the position track. */
  readSteps: (ip: string) =>
    request<StepPosition[]>(`/api/actuators/${encodeURIComponent(ip)}/steps`),

  readStep: (ip: string, number: number) =>
    request<StepResponse>(`/api/actuators/${encodeURIComponent(ip)}/steps/${number}`),

  writeStep: (ip: string, number: number, step: StepData, limited: boolean) =>
    request<StepResponse>(`/api/actuators/${encodeURIComponent(ip)}/steps/${number}`, {
      method: "PUT",
      ...json({ step, limited }),
    }),

  /** Remove a step; the ones above it move down to close the gap. */
  deleteStep: (ip: string, number: number) =>
    request<StepPosition[]>(`/api/actuators/${encodeURIComponent(ip)}/steps/${number}`, {
      method: "DELETE",
    }),

  readStepNames: (ip: string) =>
    request<StepNames>(`/api/actuators/${encodeURIComponent(ip)}/step-names`),

  writeStepName: (ip: string, number: number, name: string) =>
    request<StepNames>(
      `/api/actuators/${encodeURIComponent(ip)}/step-names/${number}`,
      { method: "PUT", ...json({ name }) },
    ),
}

/** Message the operator should actually read, from any thrown value. */
export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}
