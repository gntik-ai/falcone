// Platform-only credential storage. Never persist or log the opaque reference itself.
import { createHash, randomBytes, randomUUID } from 'node:crypto';

export const hashExecutionTokenRef = (ref) => createHash('sha256').update(ref).digest('hex');
export function newExecutionCredential({ tenantId, workspaceId, workflowId, runId = null, token }) {
  const ref = `fxr_${randomBytes(32).toString('base64url')}`;
  const { expiresAt } = JSON.parse(Buffer.from(token.split('.')[0], 'base64url').toString('utf8'));
  return { ref, row: { ref_hash: hashExecutionTokenRef(ref), tenant_id: tenantId, workspace_id: workspaceId,
    workflow_id: workflowId, run_id: runId, attempt_id: randomUUID(), token,
    expires_at: new Date(expiresAt), created_at: new Date() } };
}

export function matchesCredentialAttempt(row, execution) {
  const time = new Date(execution?.startTime).getTime();
  const created = new Date(row.created_at).getTime();
  return execution?.memo?.falconeCredentialAttempt === row.attempt_id &&
    time >= created - 5_000 && time <= created + 60_000;
}

// Ties and missing visibility are deliberately unresolved. Never infer ancestry from IDs.
export function originalCredentialRun(row, executions) {
  const matches = executions.filter((execution) => execution.workflowId === row.workflow_id && matchesCredentialAttempt(row, execution))
    .sort((a, b) => new Date(a.startTime) - new Date(b.startTime));
  if (!matches.length || (matches[1] && +new Date(matches[0].startTime) === +new Date(matches[1].startTime))) return null;
  return matches[0].runId;
}

export function createExecutionCredentialStore({ pool } = {}) {
  if (!pool) {
    const rows = new Map();
    return {
      async ensureSchema() {},
      async insert(row) { rows.set(row.ref_hash, structuredClone(row)); },
      async get(hash) { return structuredClone(rows.get(hash) ?? null); },
      async claim(hash, runId) { const row = rows.get(hash); if (row && row.run_id === null) row.run_id = runId; return structuredClone(row ?? null); },
      async unbound() { return [...rows.values()].filter((r) => r.run_id === null && +new Date(r.created_at) < Date.now() - 30_000 && +new Date(r.created_at) > Date.now() - 300_000).slice(0, 50).map((r) => structuredClone(r)); },
      async sweep() { let n = 0; for (const [hash, row] of rows) if (+new Date(row.expires_at) < Date.now() - 3_600_000 && n < 500) { rows.delete(hash); n++; } },
    };
  }
  return {
    async ensureSchema() {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(`CREATE TABLE IF NOT EXISTS public.flow_execution_credentials (
          ref_hash text PRIMARY KEY, tenant_id text NOT NULL, workspace_id text NOT NULL,
          workflow_id text NOT NULL, attempt_id text NOT NULL, token text NOT NULL, run_id text,
          expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now())`);
        await client.query('CREATE INDEX IF NOT EXISTS flow_execution_credentials_expiry_idx ON public.flow_execution_credentials (expires_at)');
        await client.query('CREATE INDEX IF NOT EXISTS flow_execution_credentials_unbound_idx ON public.flow_execution_credentials (run_id) WHERE run_id IS NULL');
        await client.query('REVOKE ALL ON TABLE public.flow_execution_credentials FROM PUBLIC');
        await client.query(`DO $$ DECLARE data_role text; BEGIN
          FOREACH data_role IN ARRAY ARRAY['falcone_service', 'falcone_anon'] LOOP
            IF EXISTS (SELECT FROM pg_roles WHERE rolname = data_role) THEN
              EXECUTE format('REVOKE ALL ON TABLE public.flow_execution_credentials FROM %I', data_role);
            END IF;
          END LOOP;
          FOREACH data_role IN ARRAY ARRAY['falcone_service', 'falcone_anon'] LOOP
            IF EXISTS (SELECT FROM pg_roles WHERE rolname = data_role) THEN
              IF has_table_privilege(data_role, 'public.flow_execution_credentials', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER') THEN
                RAISE EXCEPTION 'FLOW_CREDENTIAL_STORE_UNSAFE';
              END IF;
            END IF;
          END LOOP;
        END $$`);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        if (error.message?.includes('FLOW_CREDENTIAL_STORE_UNSAFE')) throw Object.assign(new Error('FLOW_CREDENTIAL_STORE_UNSAFE'), { code: 'FLOW_CREDENTIAL_STORE_UNSAFE' });
        throw error;
      } finally { client.release(); }
    },
    async insert(row) {
      await pool.query(`INSERT INTO public.flow_execution_credentials
        (ref_hash, tenant_id, workspace_id, workflow_id, attempt_id, token, run_id, expires_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [row.ref_hash, row.tenant_id, row.workspace_id, row.workflow_id, row.attempt_id, row.token, row.run_id, row.expires_at]);
    },
    async get(hash) { return (await pool.query('SELECT * FROM public.flow_execution_credentials WHERE ref_hash = $1', [hash])).rows[0] ?? null; },
    async claim(hash, runId) {
      await pool.query('UPDATE public.flow_execution_credentials SET run_id = $2 WHERE ref_hash = $1 AND run_id IS NULL', [hash, runId]);
      return this.get(hash);
    },
    async unbound() { return (await pool.query(`SELECT * FROM public.flow_execution_credentials
      WHERE run_id IS NULL AND created_at < now() - interval '30 seconds'
        AND created_at > now() - interval '5 minutes' ORDER BY created_at LIMIT 50`)).rows; },
    async sweep() { await pool.query(`DELETE FROM public.flow_execution_credentials WHERE ref_hash IN
      (SELECT ref_hash FROM public.flow_execution_credentials WHERE expires_at < now() - interval '1 hour' ORDER BY expires_at LIMIT 500)`); },
  };
}
