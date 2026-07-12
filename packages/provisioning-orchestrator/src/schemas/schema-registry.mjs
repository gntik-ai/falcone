/**
 * In-memory schema registry for tenant config export artifacts.
 *
 * Maintains a catalog of versioned JSON Schemas and migration functions,
 * providing lookup, checksum computation, and migration-chain resolution.
 *
 * @module schemas/schema-registry
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// --- Load schema files at module init ---

const v100SchemaPath = join(__dirname, 'v1.0.0.schema.json');
const v100SchemaRaw = readFileSync(v100SchemaPath, 'utf-8');
const v100Schema = JSON.parse(v100SchemaRaw);

// Canonical JSON for checksum: deterministic serialization (sorted keys).
const v100Canonical = JSON.stringify(v100Schema);
const v100Checksum = 'sha256:' + createHash('sha256').update(v100Canonical).digest('hex');

// --- Version catalog ---

/** @typedef {{ schema: object, checksum: string, releaseDate: string, changeNotes: string }} VersionEntry */

/** @type {Map<string, VersionEntry>} */
const versions = new Map([
  ['1.0.0', {
    schema: v100Schema,
    checksum: v100Checksum,
    releaseDate: '2026-04-01',
    changeNotes: 'Initial versioned format. Formalizes artifact produced by US-BKP-02-T01.',
  }],
]);

// --- Migrations ---

/**
 * Migration map: key is "MAJOR_FROM→MAJOR_TO" (consecutive majors only).
 * Each value is a pure function: (artifact) => { artifact, warnings? }.
 * @type {Map<string, function>}
 */
const migrations = new Map();

// --- Constants ---

const CURRENT_VERSION = '1.0.0';
const MIN_MIGRATABLE = '1.0.0';

// --- Helpers ---

/**
 * Parse a semver string into { major, minor, patch }.
 * @param {string} v
 * @returns {{ major: number, minor: number, patch: number }}
 */
function parseSemver(v) {
  const parts = v.split('.').map(Number);
  if (parts.length !== 3 || parts.some(Number.isNaN)) {
    throw new Error(`Invalid semver: '${v}'`);
  }
  return { major: parts[0], minor: parts[1], patch: parts[2] };
}

// --- Public API ---

/**
 * @returns {string} Current format version.
 */
export function getCurrentVersion() {
  return CURRENT_VERSION;
}

/**
 * @returns {string} Minimum version that can be migrated to current.
 */
export function getMinMigratable() {
  return MIN_MIGRATABLE;
}

/**
 * @returns {{ version: string, releaseDate: string, changeNotes: string, checksum: string }[]}
 */
export function getSupportedVersions() {
  return [...versions.entries()].map(([version, entry]) => ({
    version,
    release_date: entry.releaseDate,
    change_notes: entry.changeNotes,
    schema_checksum: entry.checksum,
  }));
}

/**
 * Get the JSON Schema object for a given version.
 * @param {string} version
 * @returns {object | null}
 */
export function getSchemaFor(version) {
  const entry = versions.get(version);
  if (entry) return entry.schema;

  // Same-major tolerance: if version is 1.x.x and we have 1.0.0, return that schema.
  // Backward compatibility within the same major.
  try {
    const requested = parseSemver(version);
    for (const [v, e] of versions.entries()) {
      const candidate = parseSemver(v);
      if (candidate.major === requested.major) {
        return e.schema;
      }
    }
  } catch {
    // Invalid semver format
  }
  return null;
}

/**
 * Get the sha256 checksum of the schema for a given version.
 * @param {string} version
 * @returns {string | null}
 */
export function getChecksum(version) {
  const entry = versions.get(version);
  if (entry) return entry.checksum;

  // Same-major tolerance
  try {
    const requested = parseSemver(version);
    for (const [v, e] of versions.entries()) {
      const candidate = parseSemver(v);
      if (candidate.major === requested.major) {
        return e.checksum;
      }
    }
  } catch {
    // noop
  }
  return null;
}

/**
 * Check whether two semver strings share the same major version.
 * @param {string} vA
 * @param {string} vB
 * @returns {boolean}
 */
export function isSameMajor(vA, vB) {
  try {
    return parseSemver(vA).major === parseSemver(vB).major;
  } catch {
    return false;
  }
}

/**
 * Check whether a given version string is known (exact match or same-major).
 * @param {string} version
 * @returns {boolean}
 */
export function isKnownVersion(version) {
  return getSchemaFor(version) !== null;
}

/**
 * Check whether a given version is from the future (higher than current).
 * @param {string} version
 * @returns {boolean}
 */
export function isFutureVersion(version) {
  try {
    const v = parseSemver(version);
    const c = parseSemver(CURRENT_VERSION);
    if (v.major > c.major) return true;
    if (v.major === c.major && v.minor > c.minor) return true;
    if (v.major === c.major && v.minor === c.minor && v.patch > c.patch) return true;
    return false;
  } catch {
    return false;
  }
}

/**
 * Build an ordered array of migration functions to go from `fromVersion` to `toVersion`.
 * Migrations only cross major boundaries. Within the same major, no migration is needed.
 *
 * @param {string} fromVersion
 * @param {string} toVersion
 * @returns {{ chain: string[], fns: function[] }}
 * @throws {Error} if a required migration step is missing.
 */
export function buildMigrationChain(fromVersion, toVersion) {
  const from = parseSemver(fromVersion);
  const to = parseSemver(toVersion);

  if (from.major >= to.major) {
    return { chain: [], fns: [] };
  }

  const chain = [];
  const fns = [];

  for (let m = from.major; m < to.major; m++) {
    const key = `${m}→${m + 1}`;
    const fn = migrations.get(key);
    if (!fn) {
      throw new Error(`Missing migration step: ${key}`);
    }
    chain.push(key);
    fns.push(fn);
  }

  return { chain, fns };
}

/**
 * Convenience: get the full registry as a single object (for DI / testing).
 * @returns {object}
 */
export function getSchemaRegistry() {
  return {
    getCurrentVersion,
    getMinMigratable,
    getSupportedVersions,
    getSchemaFor,
    getChecksum,
    isSameMajor,
    isKnownVersion,
    isFutureVersion,
    buildMigrationChain,
  };
}
