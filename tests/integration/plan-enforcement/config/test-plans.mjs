/**
 * Seed data: test plan definitions.
 *
 * These structures define the three test plans used throughout the
 * plan-enforcement coherence suite. They are NOT inserted by this module;
 * insertion is handled by plan-factory.mjs.
 */

/** @typedef {'hard' | 'soft'} QuotaType */
/** @typedef {{ limit: number, type: QuotaType, graceMargin?: number }} QuotaDef */

/**
 * @typedef {Object} TestPlan
 * @property {string} slug
 * @property {string} displayName
 * @property {Record<string, boolean>} capabilities
 * @property {Record<string, QuotaDef>} quotas
 */

const ALL_CAPS_FALSE = {
  realtime: false,
  webhooks: false,
  sql_admin_api: false,
  passthrough_admin: false,
  public_functions: false,
  custom_domains: false,
  scheduled_functions: false,
};

/** @type {TestPlan} */
export const TEST_STARTER = {
  slug: 'test-starter',
  displayName: 'Test Starter',
  capabilities: { ...ALL_CAPS_FALSE },
  quotas: {
    max_workspaces: { limit: 3, type: 'hard' },
    max_pg_databases: { limit: 5, type: 'hard' },
    max_kafka_topics: { limit: 5, type: 'soft', graceMargin: 2 },
    max_functions: { limit: 10, type: 'hard' },
  },
};

/** @type {TestPlan} */
export const TEST_PROFESSIONAL = {
  slug: 'test-professional',
  displayName: 'Test Professional',
  capabilities: {
    realtime: true,
    webhooks: true,
    sql_admin_api: true,
    passthrough_admin: false,
    public_functions: true,
    custom_domains: false,
    scheduled_functions: false,
  },
  quotas: {
    max_workspaces: { limit: 10, type: 'hard' },
    max_pg_databases: { limit: 20, type: 'hard' },
    max_kafka_topics: { limit: 50, type: 'soft', graceMargin: 10 },
    max_functions: { limit: 200, type: 'hard' },
  },
};

/** @type {TestPlan} */
export const TEST_ENTERPRISE = {
  slug: 'test-enterprise',
  displayName: 'Test Enterprise',
  capabilities: {
    realtime: true,
    webhooks: true,
    sql_admin_api: true,
    passthrough_admin: true,
    public_functions: true,
    custom_domains: true,
    scheduled_functions: true,
  },
  quotas: {
    max_workspaces: { limit: -1, type: 'hard' },
    max_pg_databases: { limit: 100, type: 'hard' },
    max_kafka_topics: { limit: 200, type: 'soft', graceMargin: 50 },
    max_functions: { limit: -1, type: 'hard' },
  },
};

/** All test plans keyed by slug. */
export const TEST_PLANS = {
  [TEST_STARTER.slug]: TEST_STARTER,
  [TEST_PROFESSIONAL.slug]: TEST_PROFESSIONAL,
  [TEST_ENTERPRISE.slug]: TEST_ENTERPRISE,
};

/** Ordered list for iteration. */
export const ALL_TEST_PLANS = [TEST_STARTER, TEST_PROFESSIONAL, TEST_ENTERPRISE];
