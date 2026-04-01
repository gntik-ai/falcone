/**
 * Equivalence assertion utilities for restore E2E tests.
 * Compares domain-by-domain: artifact source → tenant destination.
 * @module tests/e2e/fixtures/restore/assert-equivalence
 */

import assert from 'node:assert/strict';

/**
 * Internal fields that are expected to differ between source and destination tenants
 * due to identifier remapping (T03).
 */
const INTERNAL_ID_FIELDS = new Set([
  'realm_id', 'schema_prefix', 'namespace', 'tenant_prefix',
  'realm', 'schema', 'database',
]);

/**
 * Deep-compare two objects, excluding known internal identifier fields.
 *
 * @param {any} expected
 * @param {any} actual
 * @param {string} path
 * @returns {Array<{ path: string, expected: any, actual: any }>}
 */
function deepDiff(expected, actual, path = '') {
  const diffs = [];

  if (expected === actual) return diffs;

  if (expected == null || actual == null || typeof expected !== typeof actual) {
    diffs.push({ path, expected, actual });
    return diffs;
  }

  if (Array.isArray(expected)) {
    if (!Array.isArray(actual)) {
      diffs.push({ path, expected: 'Array', actual: typeof actual });
      return diffs;
    }

    // Compare arrays by matching on 'name' field if present (set-like comparison)
    if (expected.length > 0 && typeof expected[0] === 'object' && expected[0] !== null && 'name' in expected[0]) {
      const actualMap = new Map(actual.map(item => [item.name, item]));
      for (const expItem of expected) {
        const actItem = actualMap.get(expItem.name);
        if (!actItem) {
          diffs.push({ path: `${path}[name=${expItem.name}]`, expected: expItem, actual: undefined });
        } else {
          diffs.push(...deepDiff(expItem, actItem, `${path}[name=${expItem.name}]`));
        }
      }
    } else {
      const maxLen = Math.max(expected.length, actual.length);
      for (let i = 0; i < maxLen; i++) {
        diffs.push(...deepDiff(expected[i], actual[i], `${path}[${i}]`));
      }
    }
    return diffs;
  }

  if (typeof expected === 'object') {
    const allKeys = new Set([...Object.keys(expected), ...Object.keys(actual)]);
    for (const key of allKeys) {
      if (INTERNAL_ID_FIELDS.has(key)) continue;
      diffs.push(...deepDiff(expected[key], actual[key], path ? `${path}.${key}` : key));
    }
    return diffs;
  }

  if (expected !== actual) {
    diffs.push({ path, expected, actual });
  }
  return diffs;
}

/**
 * Assert that the restored tenant's configuration is functionally equivalent
 * to the export artifact, domain by domain.
 *
 * Uses DI: caller provides domain data from the destination tenant (either by
 * re-exporting via API, or by mock in tests).
 *
 * @param {Object} artifactDomains - source artifact's domains array
 * @param {Object} dstDomains - destination tenant's exported domains array
 * @param {string[]} domainsToCheck
 */
export function assertEquivalence(artifactDomains, dstDomains, domainsToCheck) {
  for (const dk of domainsToCheck) {
    const srcDomain = artifactDomains.find(d => d.domain_key === dk);
    const dstDomain = dstDomains.find(d => d.domain_key === dk);

    if (!srcDomain || srcDomain.status !== 'ok') continue;

    assert.ok(dstDomain, `Domain '${dk}' missing in destination tenant export`);
    assert.ok(
      dstDomain.status === 'ok' || dstDomain.status === 'empty',
      `Domain '${dk}' in destination has unexpected status '${dstDomain.status}'`,
    );

    const diffs = deepDiff(srcDomain.data, dstDomain.data);
    if (diffs.length > 0) {
      const detail = diffs.slice(0, 5).map(d =>
        `  ${d.path}: expected=${JSON.stringify(d.expected)} actual=${JSON.stringify(d.actual)}`,
      ).join('\n');
      assert.fail(
        `Equivalence check failed for domain '${dk}':\n${detail}` +
        (diffs.length > 5 ? `\n  ... and ${diffs.length - 5} more differences` : ''),
      );
    }
  }
}

/**
 * Assert that the specified domains have no resources in the destination tenant.
 *
 * @param {Object} dstDomains - destination tenant's exported domains array
 * @param {string[]} domains - domains that should be empty
 */
export function assertDomainEmpty(dstDomains, domains) {
  for (const dk of domains) {
    const domain = dstDomains.find(d => d.domain_key === dk);
    if (!domain) continue; // not present = empty
    if (domain.status === 'not_available' || domain.status === 'empty') continue;
    if (!domain.data) continue;

    // Check that data is empty
    const resourceArrays = Object.values(domain.data).filter(v => Array.isArray(v));
    for (const arr of resourceArrays) {
      assert.equal(arr.length, 0,
        `Domain '${dk}' should be empty but has ${arr.length} resources`,
      );
    }
  }
}

/**
 * Assert that resources reported as conflicts by preflight remain unchanged
 * after reprovision.
 *
 * @param {Object[]} preConflictResources - resources before reprovision (from seed)
 * @param {Object} dstDomains - destination tenant's exported domains after reprovision
 * @param {Object[]} expectedConflicts - preflight conflict list
 */
export function assertConflictsPreserved(preConflictResources, dstDomains, expectedConflicts) {
  for (const conflict of expectedConflicts) {
    const domain = dstDomains.find(d => d.domain_key === conflict.resource_type || d.domain_key === conflict.domain_key);
    if (!domain?.data) continue;

    // Find the resource in the post-reprovision state
    const resourceArrays = Object.values(domain.data).filter(v => Array.isArray(v));
    for (const arr of resourceArrays) {
      const resource = arr.find(r => r.name === conflict.resource_name);
      if (resource) {
        // Find same resource in pre-state
        const preResource = preConflictResources.find(
          r => r.name === conflict.resource_name,
        );
        if (preResource) {
          const diffs = deepDiff(preResource, resource);
          assert.equal(diffs.length, 0,
            `Conflicting resource '${conflict.resource_name}' in '${conflict.resource_type || conflict.domain_key}' was modified during reprovision`,
          );
        }
      }
    }
  }
}
