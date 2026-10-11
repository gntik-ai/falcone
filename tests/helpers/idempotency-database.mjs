// Postgres boundary double. Production atomicity is separately tested against real Postgres.
export function idempotencyDatabase({ clock = () => Date.now() } = {}) {
  const records = new Map();
  return { records, async query(sql, values = []) {
    const [tenant, principal, key, token, fingerprint] = values;
    const scope = JSON.stringify([tenant, principal, key]);
    if (sql.includes('INSERT INTO public.http_idempotency_records')) {
      const previous = records.get(scope);
      if (previous && previous.expires_at > clock()) return { rows: [], rowCount: 0 };
      const row = { tenant_id: tenant, principal_id: principal, idempotency_key: key, reservation_id: token, fingerprint, state: 'in_progress', expires_at: clock() + 86400000 };
      records.set(scope, row);
      return { rows: [row], rowCount: 1 };
    }
    if (sql.includes('SELECT') && sql.includes('public.http_idempotency_records')) {
      const row = records.get(scope);
      return { rows: row && row.expires_at > clock() ? [{ ...row }] : [], rowCount: row ? 1 : 0 };
    }
    if (sql.includes('UPDATE public.http_idempotency_records')) {
      const row = records.get(scope);
      if (row?.reservation_id !== token) return { rows: [], rowCount: 0 };
      Object.assign(row, { state: 'completed', response_status: values[4], response_body: values[5], response_headers: JSON.parse(values[6]), replay_available: values[7] });
      return { rows: [], rowCount: 1 };
    }
    if (sql.includes('DELETE FROM public.http_idempotency_records')) {
      if (sql.includes('expires_at')) {
        for (const [id, row] of records) if (row.expires_at <= clock()) records.delete(id);
      } else if (records.get(scope)?.reservation_id === token) records.delete(scope);
      return { rows: [], rowCount: 1 };
    }
    throw new Error('Unexpected idempotency database statement');
  } };
}
