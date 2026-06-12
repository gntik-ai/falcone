/**
 * Polling utility for the flows E2E suite.
 *
 * The flows API is Temporal-backed; execution status transitions are eventually consistent.
 * These helpers poll until a condition is met or a deadline passes, without using sleep().
 */

/** Poll `fn` at `intervalMs` intervals until it returns a truthy value or `timeoutMs` elapses. */
export async function pollUntil<T>(
  fn: () => Promise<T | null | undefined | false>,
  opts: { timeoutMs?: number; intervalMs?: number; label?: string } = {},
): Promise<T> {
  const { timeoutMs = 30_000, intervalMs = 1_000, label = 'condition' } = opts
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const result = await fn()
    if (result) return result
    await new Promise<void>((resolve) => setTimeout(resolve, intervalMs))
  }
  throw new Error(`pollUntil timed out after ${timeoutMs} ms waiting for: ${label}`)
}

/**
 * Normalize a Temporal execution status to title case.
 * The API returns SCREAMING_SNAKE_CASE (e.g. "COMPLETED", "FAILED", "RUNNING")
 * but spec assertions use title case ("Completed", "Failed", "Running").
 * This normalizer converts either format to title case for consistent comparison.
 */
export function normalizeStatus(status: string): string {
  // Convert UPPER_CASE or UpperCase → single word title case
  const lower = status.toLowerCase()
  // Map Temporal's status constants
  const map: Record<string, string> = {
    completed: 'Completed',
    failed: 'Failed',
    canceled: 'Canceled',
    cancelled: 'Canceled',
    terminated: 'Terminated',
    timed_out: 'TimedOut',
    running: 'Running',
    continuedasnew: 'ContinuedAsNew',
  }
  return map[lower] ?? (lower.charAt(0).toUpperCase() + lower.slice(1))
}

/**
 * Poll a flow execution until its status matches one of the expected terminal or
 * intermediate statuses. Returns the execution detail with a normalized `status` field.
 */
export async function pollExecutionStatus(
  getExecution: () => Promise<{ executionId: string; status?: string; nodes?: unknown[] }>,
  expectedStatuses: string[],
  opts: { timeoutMs?: number; intervalMs?: number } = {},
) {
  // Normalize expected statuses for comparison
  const normalizedExpected = expectedStatuses.map((s) => normalizeStatus(s))
  return pollUntil(
    async () => {
      const exec = await getExecution()
      if (exec.status) {
        const normalized = normalizeStatus(exec.status)
        // Return a patched copy with normalized status for assertions
        if (normalizedExpected.includes(normalized)) {
          return { ...exec, status: normalized }
        }
      }
      return null
    },
    {
      ...opts,
      label: `execution status in [${expectedStatuses.join(', ')}]`,
    },
  )
}

/** Poll until a node in the execution reaches the given status. Status comparison is case-insensitive. */
export async function pollNodeStatus(
  getExecution: () => Promise<{
    executionId: string
    status?: string
    nodes?: Array<{ nodeId: string; status?: string }>
  }>,
  nodeId: string,
  expectedStatus: string,
  opts: { timeoutMs?: number; intervalMs?: number } = {},
) {
  const normalizedExpected = normalizeStatus(expectedStatus)
  return pollUntil(
    async () => {
      const exec = await getExecution()
      const node = exec.nodes?.find((n) => n.nodeId === nodeId)
      if (node?.status && normalizeStatus(node.status) === normalizedExpected)
        return { ...node, status: normalizedExpected }
      return null
    },
    {
      ...opts,
      label: `node ${nodeId} status = ${expectedStatus}`,
    },
  )
}
