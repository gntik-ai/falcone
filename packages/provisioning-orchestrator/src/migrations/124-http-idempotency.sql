-- HTTP replay is separate from workflow/async-operation idempotency.
-- Forward-only, additive, safe to apply on every control-plane boot.
CREATE TABLE IF NOT EXISTS public.http_idempotency_records (
  tenant_id text NOT NULL,
  principal_id text NOT NULL,
  idempotency_key text NOT NULL,
  reservation_id uuid NOT NULL,
  fingerprint text NOT NULL,
  state text NOT NULL CHECK (state IN ('in_progress', 'completed')),
  expires_at timestamptz NOT NULL,
  response_status integer,
  response_body text,
  response_headers jsonb,
  replay_available boolean NOT NULL DEFAULT false,
  PRIMARY KEY (tenant_id, principal_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS http_idempotency_expires_at
  ON public.http_idempotency_records (expires_at);
