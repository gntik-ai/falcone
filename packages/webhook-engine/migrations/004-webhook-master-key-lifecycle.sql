-- 004-webhook-master-key-lifecycle
--
-- Additive platform lifecycle metadata for the AES-GCM key that wraps each
-- tenant-scoped per-subscription webhook secret. Existing rows deliberately
-- remain unlabeled until an explicit legacy adoption transaction proves that
-- every row decrypts with the operator-supplied historical key.

ALTER TABLE webhook_signing_secrets
  ADD COLUMN IF NOT EXISTS encryption_key_id TEXT;

CREATE INDEX IF NOT EXISTS idx_wss_encryption_key_id
  ON webhook_signing_secrets (encryption_key_id);

CREATE TABLE IF NOT EXISTS webhook_master_key_state (
  singleton_id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (singleton_id = 1),
  lifecycle_state TEXT NOT NULL CHECK (lifecycle_state IN
    ('serving', 'rotation_in_progress', 'recovery_required')),
  current_key_id TEXT NOT NULL,
  current_mode TEXT NOT NULL CHECK (current_mode IN ('canonical-v1', 'legacy')),
  current_managed BOOLEAN NOT NULL DEFAULT false,
  current_verification_cipher TEXT NOT NULL,
  current_verification_iv TEXT NOT NULL,
  recovery_key_id TEXT,
  recovery_mode TEXT CHECK (recovery_mode IS NULL OR recovery_mode IN ('canonical-v1', 'legacy')),
  recovery_managed BOOLEAN,
  recovery_verification_cipher TEXT,
  recovery_verification_iv TEXT,
  recovery_deadline TIMESTAMPTZ,
  active_request_id TEXT,
  active_rotation_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((recovery_key_id IS NULL AND recovery_mode IS NULL
          AND recovery_managed IS NULL AND recovery_verification_cipher IS NULL
          AND recovery_verification_iv IS NULL AND recovery_deadline IS NULL)
      OR (recovery_key_id IS NOT NULL AND recovery_mode IS NOT NULL
          AND recovery_managed IS NOT NULL AND recovery_verification_cipher IS NOT NULL
          AND recovery_verification_iv IS NOT NULL AND recovery_deadline IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS webhook_master_key_rotations (
  request_id TEXT PRIMARY KEY,
  action TEXT NOT NULL CHECK (action IN ('adopt', 'rotate', 'recover', 'finalize')),
  rotation_id TEXT,
  source_key_id TEXT,
  target_key_id TEXT,
  source_mode TEXT CHECK (source_mode IS NULL OR source_mode IN ('canonical-v1', 'legacy')),
  target_mode TEXT CHECK (target_mode IS NULL OR target_mode IN ('canonical-v1', 'legacy')),
  source_managed BOOLEAN,
  target_managed BOOLEAN,
  lifecycle_state TEXT NOT NULL CHECK (lifecycle_state IN
    ('started', 'completed', 'failed', 'recovery_required')),
  affected_count INTEGER NOT NULL DEFAULT 0 CHECK (affected_count >= 0),
  verified_count INTEGER NOT NULL DEFAULT 0 CHECK (verified_count >= 0),
  recovery_window_seconds INTEGER,
  recovery_deadline TIMESTAMPTZ,
  error_code VARCHAR(64),
  error_message VARCHAR(160),
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (error_code IS NULL OR error_code ~ '^[A-Z0-9_]+$'),
  CHECK (error_message IS NULL OR length(error_message) <= 160)
);

ALTER TABLE webhook_master_key_rotations
  ADD COLUMN IF NOT EXISTS source_managed BOOLEAN,
  ADD COLUMN IF NOT EXISTS target_managed BOOLEAN;

CREATE UNIQUE INDEX IF NOT EXISTS uq_webhook_master_key_rotation_id
  ON webhook_master_key_rotations (rotation_id)
  WHERE rotation_id IS NOT NULL;

-- Lifecycle tables are platform-global. They are intentionally not granted to
-- falcone_app (the normal tenant adapter role used by migration 003).
REVOKE ALL ON webhook_master_key_state FROM PUBLIC;
REVOKE ALL ON webhook_master_key_rotations FROM PUBLIC;
