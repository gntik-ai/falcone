// Black-box test suite for change reject-storage-object-key-traversal.
// Drives the PUBLIC exported surface of storage-bucket-object-ops.mjs only.
// No internal knowledge; reproduces bug-011.
//
// Tests:
//   bbx-storage-traversal-01: dot-dot segment → INVALID_OBJECT_KEY on object create
//   bbx-storage-traversal-02: dot-dot segment → INVALID_OBJECT_KEY on presigned URL (upload preview)
//   bbx-storage-traversal-03: legitimate forward-slash key → succeeds (no error)
//   bbx-storage-traversal-04: backslash in key → INVALID_OBJECT_KEY
//   bbx-storage-traversal-05: control character in key → INVALID_OBJECT_KEY
//   bbx-storage-traversal-06: dot-dot segment → INVALID_OBJECT_KEY on download preview
//   bbx-storage-traversal-07: dot-dot segment → INVALID_OBJECT_KEY on delete preview
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  assertObjectKey,
  buildStorageObjectRecord,
  previewStorageObjectUpload,
  previewStorageObjectDownload,
  previewStorageObjectDeletion,
  STORAGE_BUCKET_OBJECT_ERROR_CODES
} from '../../services/adapters/src/storage-bucket-object-ops.mjs';

// Minimal valid bucket fixture (no real I/O — purely in-memory object graph).
const TENANT_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const WS_A = 'wsaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

const BUCKET_FIXTURE = {
  tenantId: TENANT_A,
  workspaceId: WS_A,
  bucketName: 'tenant-a-bucket',
  region: 'us-east-1',
  status: 'active',
  tenant: {
    tenantId: TENANT_A,
    planId: 'plan-basic'
  },
  storage: {
    providerType: 'seaweedfs',
    config: { inline: { providerType: 'seaweedfs', region: 'us-east-1' } }
  },
  tenantStorageContext: {
    entityType: 'tenant_storage_context',
    tenantId: TENANT_A,
    providerType: 'seaweedfs',
    namespace: 'ns-a',
    state: 'active',
    bucketProvisioningAllowed: true,
    quotaAssignment: { capabilityAvailable: true }
  }
};

const TRAVERSAL_KEY = 'uploads/../../tenants/tenant-b/workspaces/ws-b/secret';

// ---------------------------------------------------------------------------
// bbx-storage-traversal-01
// dot-dot segment is rejected at assertObjectKey (object create path)
// ---------------------------------------------------------------------------
test('bbx-storage-traversal-01: dot-dot traversal key returns INVALID_OBJECT_KEY on object create', () => {
  assert.throws(
    () => buildStorageObjectRecord({ bucket: BUCKET_FIXTURE, objectKey: TRAVERSAL_KEY }),
    (err) => {
      assert.equal(
        err.message,
        STORAGE_BUCKET_OBJECT_ERROR_CODES.INVALID_OBJECT_KEY,
        `expected INVALID_OBJECT_KEY, got: ${err.message}`
      );
      return true;
    }
  );
});

// ---------------------------------------------------------------------------
// bbx-storage-traversal-02
// dot-dot segment is rejected on presigned URL generation (upload preview)
// ---------------------------------------------------------------------------
test('bbx-storage-traversal-02: dot-dot traversal key returns INVALID_OBJECT_KEY on presigned URL (upload preview)', () => {
  assert.throws(
    () => previewStorageObjectUpload({ bucket: BUCKET_FIXTURE, object: { objectKey: TRAVERSAL_KEY } }),
    (err) => {
      assert.equal(
        err.message,
        STORAGE_BUCKET_OBJECT_ERROR_CODES.INVALID_OBJECT_KEY,
        `expected INVALID_OBJECT_KEY, got: ${err.message}`
      );
      return true;
    }
  );
});

// ---------------------------------------------------------------------------
// bbx-storage-traversal-03
// Legitimate forward-slash key must NOT be rejected
// ---------------------------------------------------------------------------
test('bbx-storage-traversal-03: legitimate forward-slash key uploads/2026/report.pdf is accepted', () => {
  assert.doesNotThrow(() => {
    buildStorageObjectRecord({ bucket: BUCKET_FIXTURE, objectKey: 'uploads/2026/report.pdf' });
  });
});

// ---------------------------------------------------------------------------
// bbx-storage-traversal-04
// Backslash in key is rejected
// ---------------------------------------------------------------------------
test('bbx-storage-traversal-04: backslash in key returns INVALID_OBJECT_KEY', () => {
  assert.throws(
    () => buildStorageObjectRecord({ bucket: BUCKET_FIXTURE, objectKey: 'uploads\\file.txt' }),
    (err) => {
      assert.equal(
        err.message,
        STORAGE_BUCKET_OBJECT_ERROR_CODES.INVALID_OBJECT_KEY,
        `expected INVALID_OBJECT_KEY, got: ${err.message}`
      );
      return true;
    }
  );
});

// ---------------------------------------------------------------------------
// bbx-storage-traversal-05
// Control character (NUL, 0x00) in key is rejected
// ---------------------------------------------------------------------------
test('bbx-storage-traversal-05: control character (NUL) in key returns INVALID_OBJECT_KEY', () => {
  const keyWithNul = 'uploads/file\x00.txt';
  assert.throws(
    () => buildStorageObjectRecord({ bucket: BUCKET_FIXTURE, objectKey: keyWithNul }),
    (err) => {
      assert.equal(
        err.message,
        STORAGE_BUCKET_OBJECT_ERROR_CODES.INVALID_OBJECT_KEY,
        `expected INVALID_OBJECT_KEY, got: ${err.message}`
      );
      return true;
    }
  );
});

// ---------------------------------------------------------------------------
// bbx-storage-traversal-06
// dot-dot segment is rejected on download preview
// ---------------------------------------------------------------------------
test('bbx-storage-traversal-06: dot-dot traversal key returns INVALID_OBJECT_KEY on download preview', () => {
  assert.throws(
    () => previewStorageObjectDownload({ bucket: BUCKET_FIXTURE, object: { objectKey: TRAVERSAL_KEY } }),
    (err) => {
      assert.equal(
        err.message,
        STORAGE_BUCKET_OBJECT_ERROR_CODES.INVALID_OBJECT_KEY,
        `expected INVALID_OBJECT_KEY, got: ${err.message}`
      );
      return true;
    }
  );
});

// ---------------------------------------------------------------------------
// bbx-storage-traversal-07
// dot-dot segment is rejected on delete preview
// ---------------------------------------------------------------------------
test('bbx-storage-traversal-07: dot-dot traversal key returns INVALID_OBJECT_KEY on delete preview', () => {
  assert.throws(
    () => previewStorageObjectDeletion({ bucket: BUCKET_FIXTURE, object: { objectKey: TRAVERSAL_KEY } }),
    (err) => {
      assert.equal(
        err.message,
        STORAGE_BUCKET_OBJECT_ERROR_CODES.INVALID_OBJECT_KEY,
        `expected INVALID_OBJECT_KEY, got: ${err.message}`
      );
      return true;
    }
  );
});

// ---------------------------------------------------------------------------
// assertObjectKey unit-level: direct tests of the exported validator
// ---------------------------------------------------------------------------
test('bbx-storage-traversal-assert-01: assertObjectKey rejects dot-dot segment', () => {
  assert.throws(
    () => assertObjectKey('uploads/../secret'),
    (err) => err.message === STORAGE_BUCKET_OBJECT_ERROR_CODES.INVALID_OBJECT_KEY
  );
});

test('bbx-storage-traversal-assert-02: assertObjectKey rejects backslash', () => {
  assert.throws(
    () => assertObjectKey('uploads\\file.txt'),
    (err) => err.message === STORAGE_BUCKET_OBJECT_ERROR_CODES.INVALID_OBJECT_KEY
  );
});

test('bbx-storage-traversal-assert-03: assertObjectKey rejects control char 0x1F', () => {
  assert.throws(
    () => assertObjectKey('uploads/file\x1f.txt'),
    (err) => err.message === STORAGE_BUCKET_OBJECT_ERROR_CODES.INVALID_OBJECT_KEY
  );
});

test('bbx-storage-traversal-assert-04: assertObjectKey rejects DEL (0x7F)', () => {
  assert.throws(
    () => assertObjectKey('uploads/file\x7f.txt'),
    (err) => err.message === STORAGE_BUCKET_OBJECT_ERROR_CODES.INVALID_OBJECT_KEY
  );
});

test('bbx-storage-traversal-assert-05: assertObjectKey accepts valid nested path', () => {
  assert.doesNotThrow(() => assertObjectKey('uploads/2026/report.pdf'));
});

test('bbx-storage-traversal-assert-06: assertObjectKey accepts single-level key', () => {
  assert.doesNotThrow(() => assertObjectKey('report.pdf'));
});
