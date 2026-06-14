import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  validateBucketName,
  assertValidBucketName,
  sanitizeBucketName,
  InvalidBucketNameError,
} from '../../src/utils/bucket-name-validator.mjs';

describe('bucket-name-validator', () => {
  it('accepts a valid DNS-safe name', () => {
    for (const name of ['abc', 'ws-1234abcd-assets', 'a-b-c', 'a'.repeat(63)]) {
      assert.deepEqual(validateBucketName(name), { valid: true, reason: null });
      assert.equal(assertValidBucketName(name), name);
    }
  });

  it('rejects uppercase letters', () => {
    const res = validateBucketName('AcmeUploads');
    assert.equal(res.valid, false);
    assert.match(res.reason, /uppercase/);
    assert.throws(() => assertValidBucketName('AcmeUploads'), InvalidBucketNameError);
  });

  it('rejects underscores', () => {
    const res = validateBucketName('acme_uploads');
    assert.equal(res.valid, false);
    assert.match(res.reason, /underscore/);
    assert.throws(() => assertValidBucketName('acme_uploads'), (e) => e.code === 'INVALID_BUCKET_NAME');
  });

  it('rejects names shorter than 3 characters', () => {
    const res = validateBucketName('ab');
    assert.equal(res.valid, false);
    assert.match(res.reason, /at least 3/);
    assert.throws(() => assertValidBucketName('ab'), InvalidBucketNameError);
  });

  it('rejects names longer than 63 characters', () => {
    const res = validateBucketName('a'.repeat(64));
    assert.equal(res.valid, false);
    assert.match(res.reason, /at most 63/);
    assert.throws(() => assertValidBucketName('a'.repeat(64)), InvalidBucketNameError);
  });

  it('rejects empty / non-string input', () => {
    assert.equal(validateBucketName('').valid, false);
    assert.equal(validateBucketName(undefined).valid, false);
    assert.equal(validateBucketName(null).valid, false);
  });

  it('sanitizeBucketName mirrors the storage-handlers DNS rule', () => {
    assert.equal(sanitizeBucketName('Acme Uploads!!'), 'acme-uploads');
    assert.equal(sanitizeBucketName('__weird__name__'), 'weird-name');
    assert.equal(sanitizeBucketName('UPPER-CASE'), 'upper-case');
    // truncates to 63 chars
    assert.equal(sanitizeBucketName('x'.repeat(80)).length, 63);
    // a sanitized name is always valid once it meets the minimum length
    assert.equal(validateBucketName(sanitizeBucketName('my-workspace-assets')).valid, true);
  });
});
