/**
 * Billing usage-record emitter (pure + dependency-injected core).
 *
 * No kafkajs / pg import at module scope — every external dependency (pg client,
 * Kafka producer, audit client, snapshot resolver, billing adapter) is passed
 * in, so this module is safe to load and exercise in black-box tests.
 *
 * Pipeline per `quota_metering` cycle completion:
 *   processCycleCompletion(cycle, deps)
 *     for each tenant in cycle.processedScopes:
 *       resolve snapshot  -> createUsageRecord (idempotent on cycle_id,tenant_id)
 *       if created:        -> publishUsageEvent + emitBillingAuditEvent + adapter
 */

export const BILLING_USAGE_TOPIC = 'console.billing.usage';
export const BILLING_AUDIT_CATEGORY = 'billing_boundary_change';
export const BILLING_AUDIT_SUBSYSTEM = 'quota_metering';

/**
 * Derive the keys of dimensions reported as degraded (usageStatus unknown or a
 * usageUnknownReason present), used to mark records and enrich the Kafka payload.
 *
 * @param {Array<object>} dimensions
 * @returns {string[]}
 */
export function degradedDimensionKeys(dimensions = []) {
  if (!Array.isArray(dimensions)) return [];
  return dimensions
    .filter((d) => d && (d.usageStatus === 'unknown' || d.usageStatus === 'degraded' || d.usageUnknownReason))
    .map((d) => d.dimensionKey)
    .filter(Boolean);
}

/**
 * Insert one usage record idempotently on (cycle_id, tenant_id).
 *
 * Uses INSERT ... ON CONFLICT (cycle_id, tenant_id) DO NOTHING RETURNING *.
 * When the pair already exists the RETURNING clause yields no row, which we
 * surface as `created: false` (deduplication) without modifying the existing
 * record.
 *
 * @param {{ query: Function }} db
 * @param {{ cycleId: string, tenantId: string, dimensions: any,
 *           snapshotTimestamp: string, hasDegradedDimensions?: boolean }} input
 * @returns {Promise<{ record: object|null, created: boolean }>}
 */
export async function createUsageRecord(db, input) {
  const { cycleId, tenantId, dimensions, snapshotTimestamp, hasDegradedDimensions = false } = input;
  const text = `
    INSERT INTO billing_usage_records (cycle_id, tenant_id, snapshot_at, dimensions, has_degraded_dimensions)
    VALUES ($1, $2, $3, $4::jsonb, $5)
    ON CONFLICT (cycle_id, tenant_id) DO NOTHING
    RETURNING *
  `;
  const params = [cycleId, tenantId, snapshotTimestamp, JSON.stringify(dimensions ?? []), hasDegradedDimensions];
  const result = await db.query(text, params);
  const record = result?.rows?.[0] ?? null;
  return { record, created: Boolean(record) };
}

/**
 * Build the structured Kafka envelope for a newly created usage record.
 * @param {object} record
 * @returns {object}
 */
export function buildUsageEnvelope(record) {
  const dimensions = record.dimensions ?? [];
  return {
    schema: 'billing.usage.v1',
    scope: 'tenant',
    tenant_id: record.tenant_id,
    tenantId: record.tenant_id,
    cycleId: record.cycle_id,
    cycle_id: record.cycle_id,
    snapshot_at: record.snapshot_at,
    snapshotTimestamp: record.snapshot_at,
    dimensions,
    has_degraded_dimensions: Boolean(record.has_degraded_dimensions),
    hasDegradedDimensions: Boolean(record.has_degraded_dimensions),
    degradedDimensions: degradedDimensionKeys(dimensions),
    degraded_dimensions: degradedDimensionKeys(dimensions)
  };
}

/**
 * Publish a usage record to console.billing.usage — ONLY when newly created.
 * @param {{ send: Function }} producer
 * @param {{ record: object, created: boolean }} outcome
 */
export async function publishUsageEvent(producer, { record, created }) {
  if (!created || !record) return false;
  const envelope = buildUsageEnvelope(record);
  await producer.send({
    topic: BILLING_USAGE_TOPIC,
    messages: [
      {
        key: record.tenant_id,
        value: JSON.stringify(envelope),
        headers: {
          tenantId: String(record.tenant_id ?? ''),
          cycleId: String(record.cycle_id ?? '')
        }
      }
    ]
  });
  return true;
}

/**
 * Emit a billing_boundary_change audit event — ONLY when newly created.
 * @param {{ emit: Function }} auditClient
 * @param {{ record: object, created: boolean }} outcome
 */
export async function emitBillingAuditEvent(auditClient, { record, created }) {
  if (!created || !record) return false;
  await auditClient.emit({
    action_category: BILLING_AUDIT_CATEGORY,
    actionCategory: BILLING_AUDIT_CATEGORY,
    subsystem_id: BILLING_AUDIT_SUBSYSTEM,
    subsystemId: BILLING_AUDIT_SUBSYSTEM,
    tenant_id: record.tenant_id,
    tenantId: record.tenant_id,
    scope: 'tenant',
    detail: {
      cycleId: record.cycle_id,
      recordId: record.id,
      hasDegradedDimensions: Boolean(record.has_degraded_dimensions)
    }
  });
  return true;
}

/**
 * Pluggable billing adapter factory. The default adapter is a no-op; operators
 * select an external adapter (webhook/Stripe) via BILLING_ADAPTER_TYPE /
 * BILLING_ADAPTER_URL. Unknown types fall back to the no-op so a misconfigured
 * adapter never blocks the metering loop.
 *
 * @param {{ type?: string, url?: string, deliver?: Function }} [config]
 * @returns {{ onUsageRecord: Function }}
 */
export function createBillingAdapter(config = {}) {
  const type = config.type ?? process.env.BILLING_ADAPTER_TYPE ?? 'noop';
  const url = config.url ?? process.env.BILLING_ADAPTER_URL ?? null;

  if ((type === 'webhook' || type === 'stripe') && typeof config.deliver === 'function') {
    return {
      type,
      url,
      async onUsageRecord(record) {
        await config.deliver(buildUsageEnvelope(record), { type, url });
      }
    };
  }

  // Default no-op adapter.
  return {
    type: 'noop',
    url,
    async onUsageRecord() {
      /* no-op */
    }
  };
}

/**
 * Process a completed metering cycle: one idempotent usage record per tenant in
 * processedScopes, with publish + audit + adapter side-effects fired only for
 * newly created records.
 *
 * @param {{ cycleId: string, snapshotTimestamp: string,
 *           processedScopes: string[], degradedDimensions?: any[] }} cycle
 * @param {{ db, producer, auditClient, billingAdapter, resolveSnapshot,
 *           batchSize?: number }} deps
 * @returns {Promise<{ created: number, deduplicated: number, records: object[] }>}
 */
export async function processCycleCompletion(cycle, deps) {
  const { db, producer, auditClient, resolveSnapshot } = deps;
  const billingAdapter = deps.billingAdapter ?? createBillingAdapter({});
  const scopes = Array.isArray(cycle?.processedScopes) ? cycle.processedScopes : [];
  const batchSize = Number.isInteger(deps.batchSize) && deps.batchSize > 0 ? deps.batchSize : scopes.length || 1;

  let created = 0;
  let deduplicated = 0;
  const records = [];

  for (let i = 0; i < scopes.length; i += batchSize) {
    const batch = scopes.slice(i, i + batchSize);
    for (const tenantId of batch) {
      const snapshot = await resolveSnapshot(tenantId);
      const dimensions = snapshot?.dimensions ?? [];
      const degradedKeys = degradedDimensionKeys(dimensions);
      const hasDegradedDimensions = degradedKeys.length > 0;
      const snapshotTimestamp = cycle.snapshotTimestamp ?? snapshot?.snapshotAt ?? null;

      const outcome = await createUsageRecord(db, {
        cycleId: cycle.cycleId,
        tenantId,
        dimensions,
        snapshotTimestamp,
        hasDegradedDimensions
      });

      if (outcome.created) {
        created += 1;
        records.push(outcome.record);
        if (producer) await publishUsageEvent(producer, outcome);
        if (auditClient) await emitBillingAuditEvent(auditClient, outcome);
        if (billingAdapter) await billingAdapter.onUsageRecord(outcome.record);
      } else {
        deduplicated += 1;
      }
    }
  }

  return { created, deduplicated, records };
}
