-- 002-signing-secret-tenant-scope
--
-- Adds the tenant dimension to webhook_signing_secrets so that the most
-- sensitive table in the webhook engine carries the same (tenant_id,
-- workspace_id) invariant as its siblings (webhook_subscriptions,
-- webhook_deliveries). Columns are added nullable, back-filled from the parent
-- subscription via the subscription_id FK, then set NOT NULL.
--
-- The per-query (tenant_id, workspace_id) predicate that consumes these columns
-- lives in the deployed db access layer (injected into the actions, SQL out of
-- this source tree); the application threads tenant_id/workspace_id into every
-- secret db call (insertSecret/rotateSecret/listSecrets) so that predicate can
-- be applied.

ALTER TABLE webhook_signing_secrets
  ADD COLUMN IF NOT EXISTS tenant_id TEXT,
  ADD COLUMN IF NOT EXISTS workspace_id TEXT;

-- Back-fill the tenant dimension from the parent subscription row.
UPDATE webhook_signing_secrets wss
   SET tenant_id = ws.tenant_id,
       workspace_id = ws.workspace_id
  FROM webhook_subscriptions ws
 WHERE wss.subscription_id = ws.id;

-- After back-fill, every row carries the tenant dimension; enforce it.
ALTER TABLE webhook_signing_secrets
  ALTER COLUMN tenant_id SET NOT NULL,
  ALTER COLUMN workspace_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_wss_tenant_workspace
  ON webhook_signing_secrets (tenant_id, workspace_id);
