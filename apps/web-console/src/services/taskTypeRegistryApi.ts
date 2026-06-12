// Task-type registry client for the console flow designer (change: add-console-flow-designer).
//
// Fetches the server task-type catalog (driven by #360's activity registry, exposed via the
// control-plane endpoint added in this change — see design.md DV2):
//   GET /v1/flows/workspaces/{workspaceId}/task-types -> { items: TaskTypeDescriptor[] }
//
// The palette is driven ENTIRELY by this response; no task type is hard-coded in the UI.
import { requestConsoleSessionJson } from '@/lib/console-session'
import type { TaskTypeDescriptor } from '@/types/flows'

const enc = encodeURIComponent

export async function listTaskTypes(workspaceId: string): Promise<TaskTypeDescriptor[]> {
  const response = await requestConsoleSessionJson<{ items: TaskTypeDescriptor[] }>(
    `/v1/flows/workspaces/${enc(workspaceId)}/task-types`
  )
  return response.items ?? []
}
