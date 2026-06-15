// ResumeTokenStore — adapted for logical replication (change add-ferretdb-realtime-cdc-remediation,
// #460). Previously stored an opaque MongoDB change-stream resume token (the raw `_id` BSON). The
// CDC bridge now consumes a Postgres logical replication slot, whose durable cursor is the Log
// Sequence Number (LSN). This persists the last confirmed LSN per capture config as a JSONB value
// `{"lsn":"0/1A2B3C4D"}`. The table and columns are unchanged (no migration needed) — only the
// value shape changes.
export class ResumeTokenStore {
  constructor(pool) { this.pool = pool; }

  // Returns the last persisted LSN string (e.g. "0/1A2B3C4D"), or null if none.
  async get(captureId) {
    const { rows } = await this.pool.query('SELECT resume_token FROM mongo_capture_resume_tokens WHERE capture_id = $1 LIMIT 1', [captureId]);
    return rows[0]?.resume_token?.lsn ?? null;
  }

  // Persists the confirmed LSN for a capture config (call AFTER the change is durably published).
  async upsert(captureId, lsn) {
    const value = JSON.stringify({ lsn });
    const { rows } = await this.pool.query(`INSERT INTO mongo_capture_resume_tokens (capture_id, resume_token) VALUES ($1,$2::jsonb)
      ON CONFLICT (capture_id) DO UPDATE SET resume_token = $2::jsonb, updated_at = now() RETURNING *`, [captureId, value]);
    return rows[0];
  }

  async delete(captureId) { await this.pool.query('DELETE FROM mongo_capture_resume_tokens WHERE capture_id = $1', [captureId]); }
}
