export function createFakeProducer() { return { messages: [], async send(payload) { this.messages.push(payload); } }; }
export function createFakeDb() {
  const db = {
    _catalog: [
      { dimension_key: 'max_workspaces', display_label: 'Maximum Workspaces', unit: 'count', default_value: 3, description: 'Maximum number of workspaces per tenant' },
      { dimension_key: 'max_pg_databases', display_label: 'Maximum PostgreSQL Databases', unit: 'count', default_value: 5, description: 'Maximum number of PostgreSQL databases per tenant' },
      { dimension_key: 'max_mongo_databases', display_label: 'Maximum MongoDB Databases', unit: 'count', default_value: 2, description: 'Maximum number of MongoDB databases per tenant' },
      { dimension_key: 'max_kafka_topics', display_label: 'Maximum Kafka Topics', unit: 'count', default_value: 10, description: 'Maximum number of Kafka topics per tenant' },
      { dimension_key: 'max_functions', display_label: 'Maximum Functions', unit: 'count', default_value: 50, description: 'Maximum number of serverless functions per tenant' },
      { dimension_key: 'max_storage_bytes', display_label: 'Maximum Storage', unit: 'bytes', default_value: 5368709120, description: 'Maximum object storage capacity per tenant in bytes (default 5 GiB)' },
      { dimension_key: 'max_api_keys', display_label: 'Maximum API Keys', unit: 'count', default_value: 20, description: 'Maximum number of API keys per tenant' },
      { dimension_key: 'max_workspace_members', display_label: 'Maximum Workspace Members', unit: 'count', default_value: 10, description: 'Maximum number of members per workspace' }
    ],
    plans: new Map(),
    assignments: new Map(),
    _quotaOverrides: [],
    _planAuditEvents: [],
    _quotaEnforcementLog: [],
    apiKeys: [],
    workspaces: [],
    async query(sql, params=[]) {
      if (sql.startsWith('BEGIN') || sql.startsWith('COMMIT') || sql.startsWith('ROLLBACK') || sql.startsWith('SET LOCAL')) return { rows: [] };
      if (sql.includes('FROM quota_dimension_catalog') && sql.includes('ORDER BY')) return { rows: this._catalog };
      if (sql.includes('FROM quota_dimension_catalog') && sql.includes('WHERE dimension_key = $1')) return { rows: this._catalog.filter((r) => r.dimension_key === params[0]) };
      if (sql.startsWith('SELECT id, status, slug, quota_dimensions, quota_type_config FROM plans WHERE id = $1')) { const p=this.plans.get(params[0]); return { rows: p ? [p] : [] }; }
      if (sql.startsWith('SELECT quota_dimensions, quota_type_config FROM plans WHERE id = $1')) { const p=this.plans.get(params[0]); return { rows: p ? [p] : [] }; }
      if (sql.startsWith('UPDATE plans')) { const p=this.plans.get(params[0]); p.quota_dimensions = { ...(p.quota_dimensions ?? {}), [params[1]]: params[2] }; p.quota_type_config = JSON.parse(params[3]); return { rows: [p] }; }
      if (sql.includes('FROM tenant_plan_assignments') && sql.includes('JOIN plans')) { const a=this.assignments.get(params[0]); if (!a) return { rows: [] }; const p=this.plans.get(a.plan_id); return { rows: [{ plan_id:p.id, plan_slug:p.slug, plan_status:p.status, quota_dimensions:p.quota_dimensions ?? {}, quota_type_config:p.quota_type_config ?? {} }] }; }
      if (sql.startsWith('INSERT INTO plan_audit_events')) { this._planAuditEvents.push({ action_type: params[0], actor_id: params[1], tenant_id: params[2], plan_id: params[3], previous_state: JSON.parse(params[4]), new_state: JSON.parse(params[5]), correlation_id: params[6], created_at: new Date().toISOString() }); return { rows: [] }; }
      if (sql.includes('SELECT COUNT(*)::int AS observed_usage FROM workspaces')) return { rows: [{ observed_usage: this.workspaces.filter((w) => w.tenant_id === params[0]).length }] };
      if (sql.includes('SELECT COUNT(*)::int AS observed_usage FROM api_keys')) return { rows: [{ observed_usage: this.apiKeys.filter((w) => w.tenant_id === params[0]).length }] };
      throw new Error(`Unhandled SQL: ${sql}`);
    }
  };
  return db;
}
export function seedPlans(db) {
  db.plans.set('plan-active', { id: 'plan-active', status: 'active', slug: 'starter-active', quota_dimensions: { max_workspaces: 5, max_kafka_topics: 20 }, quota_type_config: { max_workspaces: { type: 'hard', graceMargin: 0 }, max_kafka_topics: { type: 'soft', graceMargin: 5 } } });
  db.plans.set('plan-deprecated', { id: 'plan-deprecated', status: 'deprecated', slug: 'starter-deprecated', quota_dimensions: {}, quota_type_config: {} });
  db.assignments.set('tenant-a', { tenant_id: 'tenant-a', plan_id: 'plan-active' });
  db.assignments.set('tenant-b', { tenant_id: 'tenant-b', plan_id: 'plan-active' });
}
