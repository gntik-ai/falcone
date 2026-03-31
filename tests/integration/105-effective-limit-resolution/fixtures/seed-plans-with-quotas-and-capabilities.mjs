export function createFakeDb() {
  return {
    catalogDimensions: [
      { dimension_key: 'max_workspaces', display_label: 'Maximum Workspaces', unit: 'count', default_value: 3, sort_order: 10 },
      { dimension_key: 'max_pg_databases', display_label: 'Maximum PostgreSQL Databases', unit: 'count', default_value: 5, sort_order: 20 },
      { dimension_key: 'max_kafka_topics', display_label: 'Maximum Kafka Topics', unit: 'count', default_value: 10, sort_order: 30 },
      { dimension_key: 'max_functions', display_label: 'Maximum Functions', unit: 'count', default_value: 50, sort_order: 40 }
    ],
    booleanCatalog: [
      { capability_key: 'sql_admin_api', display_label: 'SQL Admin API', platform_default: false, sort_order: 10 },
      { capability_key: 'passthrough_admin', display_label: 'Passthrough Admin Proxy', platform_default: false, sort_order: 20 },
      { capability_key: 'realtime', display_label: 'Realtime Subscriptions', platform_default: false, sort_order: 30 },
      { capability_key: 'webhooks', display_label: 'Outbound Webhooks', platform_default: false, sort_order: 40 },
      { capability_key: 'public_functions', display_label: 'Public Serverless Functions', platform_default: false, sort_order: 50 },
      { capability_key: 'custom_domains', display_label: 'Custom Domains', platform_default: false, sort_order: 60 },
      { capability_key: 'scheduled_functions', display_label: 'Scheduled Functions', platform_default: false, sort_order: 70 },
      { capability_key: 'batch_exports', display_label: 'Batch Exports', platform_default: false, sort_order: 80 }
    ],
    plans: new Map(),
    assignments: new Map(),
    _quotaOverrides: [],
    _workspaceSubQuotas: [],
    _planAuditEvents: []
  };
}

export function createFakeProducer() {
  return {
    sent: [],
    async send(payload) { this.sent.push(payload); }
  };
}

export function seedPlans(db) {
  db.plans.set('starter', { id: 'starter', status: 'active', slug: 'starter', display_name: 'Starter', quota_dimensions: { max_workspaces: 5, max_functions: 50 }, quota_type_config: { max_workspaces: { type: 'hard', graceMargin: 0 }, max_functions: { type: 'hard', graceMargin: 0 } }, capabilities: { realtime: false } });
  db.plans.set('professional', { id: 'professional', status: 'active', slug: 'professional', display_name: 'Professional', quota_dimensions: { max_workspaces: 10, max_functions: 200, max_pg_databases: 10 }, quota_type_config: { max_workspaces: { type: 'hard', graceMargin: 0 }, max_functions: { type: 'soft', graceMargin: 10 }, max_pg_databases: { type: 'hard', graceMargin: 0 } }, capabilities: { realtime: true, webhooks: true, sql_admin_api: true } });
  db.plans.set('unlimited', { id: 'unlimited', status: 'active', slug: 'unlimited', display_name: 'Unlimited', quota_dimensions: { max_functions: -1 }, quota_type_config: { max_functions: { type: 'hard', graceMargin: 0 } }, capabilities: {} });
}

export function seedAssignments(db) {
  db.assignments.set('acme-corp', { tenant_id: 'acme-corp', plan_id: 'starter' });
  db.assignments.set('pro-corp', { tenant_id: 'pro-corp', plan_id: 'professional' });
  db.assignments.set('unlimited-corp', { tenant_id: 'unlimited-corp', plan_id: 'unlimited' });
  db.assignments.set('tenant-a', { tenant_id: 'tenant-a', plan_id: 'professional' });
  db.assignments.set('tenant-b', { tenant_id: 'tenant-b', plan_id: 'starter' });
}
