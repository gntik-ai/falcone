/**
 * OpenWhisk action: expire stale restore confirmation requests (US-BKP-01-T04).
 * Scheduled via scheduling-engine at every minute.
 */

import { expireStale } from './confirmations.service.js'

interface ActionResponse {
  statusCode: number
  body: unknown
}

export async function main(): Promise<ActionResponse> {
  const enabled = process.env.EXPIRY_JOB_ENABLED !== 'false'
  if (!enabled) {
    return { statusCode: 200, body: { skipped: true, reason: 'EXPIRY_JOB_ENABLED=false' } }
  }

  try {
    const count = await expireStale(new Date())
    console.log(`[expiry-job] expired ${count} stale confirmation requests`)
    return { statusCode: 200, body: { expired_count: count } }
  } catch (err) {
    console.error('[expiry-job] error:', err)
    return { statusCode: 500, body: { error: err instanceof Error ? err.message : String(err) } }
  }
}
