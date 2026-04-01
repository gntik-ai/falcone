/**
 * Shared types and constants for the reprovision feature.
 * @module reprovision/types
 */

/** @type {readonly string[]} */
export const KNOWN_DOMAINS = ['iam', 'postgres_metadata', 'mongo_metadata', 'kafka', 'functions', 'storage'];

/** @type {readonly string[]} */
export const SKIPPABLE_STATUSES = ['error', 'not_available', 'not_requested'];

export const REDACTED_MARKER = '***REDACTED***';

/**
 * @typedef {'applied'|'applied_with_warnings'|'skipped'|'skipped_not_exportable'|'skipped_no_applier'|'conflict'|'error'|'would_apply'|'would_apply_with_warnings'|'would_conflict'|'would_skip'} DomainStatus
 */

/**
 * @typedef {'created'|'skipped'|'conflict'|'error'|'applied_with_warnings'|'would_create'|'would_skip'|'would_conflict'} ResourceAction
 */

/**
 * @typedef {Object} ResourceResult
 * @property {string} resource_type
 * @property {string} resource_name
 * @property {string|null} resource_id
 * @property {ResourceAction} action
 * @property {string|null} message
 * @property {string[]} warnings
 * @property {Object|null} diff
 */

/**
 * @typedef {Object} DomainResult
 * @property {string} domain_key
 * @property {DomainStatus} status
 * @property {ResourceResult[]} resource_results
 * @property {{ created: number, skipped: number, conflicts: number, errors: number, warnings: number }} counts
 * @property {string|null} message
 */

/**
 * @typedef {Object} ReprovisionSummary
 * @property {number} domains_requested
 * @property {number} domains_processed
 * @property {number} domains_skipped
 * @property {number} resources_created
 * @property {number} resources_skipped
 * @property {number} resources_conflicted
 * @property {number} resources_failed
 */

/**
 * @typedef {Object} IdentifierMapEntry
 * @property {string} from
 * @property {string} to
 * @property {string|null} [scope]
 */

/**
 * Build a zero-count object.
 * @returns {{ created: number, skipped: number, conflicts: number, errors: number, warnings: number }}
 */
export function zeroCounts() {
  return { created: 0, skipped: 0, conflicts: 0, errors: 0, warnings: 0 };
}

/**
 * Build a ReprovisionSummary from an array of DomainResults.
 * @param {DomainResult[]} domainResults
 * @param {number} domainsRequested
 * @returns {ReprovisionSummary}
 */
export function buildSummary(domainResults, domainsRequested) {
  let domainsProcessed = 0;
  let domainsSkipped = 0;
  let resourcesCreated = 0;
  let resourcesSkipped = 0;
  let resourcesConflicted = 0;
  let resourcesFailed = 0;

  for (const dr of domainResults) {
    if (dr.status === 'skipped' || dr.status === 'skipped_not_exportable' || dr.status === 'skipped_no_applier' || dr.status === 'would_skip') {
      domainsSkipped++;
    } else {
      domainsProcessed++;
    }
    if (dr.counts) {
      resourcesCreated += dr.counts.created;
      resourcesSkipped += dr.counts.skipped;
      resourcesConflicted += dr.counts.conflicts;
      resourcesFailed += dr.counts.errors;
    }
  }

  return {
    domains_requested: domainsRequested,
    domains_processed: domainsProcessed,
    domains_skipped: domainsSkipped,
    resources_created: resourcesCreated,
    resources_skipped: resourcesSkipped,
    resources_conflicted: resourcesConflicted,
    resources_failed: resourcesFailed,
  };
}
