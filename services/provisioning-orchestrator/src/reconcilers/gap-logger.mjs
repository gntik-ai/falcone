/**
 * Structured gap log for the SeaweedFS bucket reconciliation.
 *
 * Accumulates one entry per lifecycle/policy/CORS/versioning decision and writes
 * each as newline-delimited JSON so operators can audit exactly what was applied,
 * shimmed, or dropped — without inspecting the storage backend.
 *
 * @module reconcilers/gap-logger
 */

/**
 * @typedef {Object} GapEntry
 * @property {string} bucketName
 * @property {('lifecycle'|'policy'|'cors'|'versioning')} configType
 * @property {string} seaweedfsVersion
 * @property {('applied'|'partial'|'drop')} decision
 * @property {string[]} [omittedFields] - present for `partial` decisions
 * @property {string} [reason]          - present for `drop` decisions
 * @property {string} [shim]            - the chosen shim, when one was applied
 */

export class GapLogger {
  /**
   * @param {Object} [opts]
   * @param {{ write: (chunk: string) => unknown }} [opts.stream] - sink for NDJSON (default: process.stdout)
   */
  constructor({ stream = process.stdout } = {}) {
    this._stream = stream;
    /** @type {GapEntry[]} */
    this._entries = [];
  }

  /**
   * Append a structured entry and emit it as one NDJSON line.
   * @param {GapEntry} entry
   * @returns {GapEntry} the recorded entry
   */
  record(entry) {
    this._entries.push(entry);
    if (this._stream && typeof this._stream.write === 'function') {
      this._stream.write(`${JSON.stringify(entry)}\n`);
    }
    return entry;
  }

  /** @returns {GapEntry[]} a copy of all recorded entries */
  get entries() {
    return this._entries.slice();
  }

  /** @returns {string} all entries joined as newline-delimited JSON */
  toNdjson() {
    return this._entries.map((e) => JSON.stringify(e)).join('\n');
  }
}
