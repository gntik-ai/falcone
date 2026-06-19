// Postgres-backed `db` adapter for the webhook-management action (#643).
//
// The webhook-management action (services/webhook-engine/actions/webhook-management.mjs)
// is storage-agnostic: it calls an injected `db` object. On the kind runtime we
// build that object from the control-plane pg pool here.
//
// Tenant isolation is enforced IN THIS ADAPTER's SQL: every query that the action
// supplies a (tenant_id, workspace_id) pair for carries an
// `AND tenant_id = $ AND workspace_id = $` predicate, so a known/guessed
// subscription_id alone can never read or rotate across tenant boundaries. This
// is app-level (defense-in-app) isolation, consistent with the runtime's other
// domain-B tables. Database-enforced RLS (migration 003, FORCE ROW LEVEL
// SECURITY keyed on current_setting('app.tenant_id')) is intentionally NOT
// applied on kind here — see webhook-schema.mjs.
//
// `getSubscription(id)` is the one method that does NOT scope by tenant in SQL:
// the action passes only the id and applies the tenant check itself
// (requireSubscription compares row.tenant_id/workspace_id to the caller and
// returns 404 on mismatch). The adapter preserves that contract.

export function buildWebhookDb(pool) {
  return {
    async getWorkspaceSubscriptionCount(tenantId, workspaceId) {
      const { rows } = await pool.query(
        `SELECT count(*)::int AS count
           FROM webhook_subscriptions
          WHERE tenant_id = $1 AND workspace_id = $2 AND deleted_at IS NULL`,
        [tenantId, workspaceId],
      );
      return rows[0]?.count ?? 0;
    },

    async insertSubscription(record) {
      await pool.query(
        `INSERT INTO webhook_subscriptions
           (id, tenant_id, workspace_id, target_url, event_types, status,
            consecutive_failures, max_consecutive_failures, description,
            created_by, created_at, updated_at, metadata)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [
          record.id, record.tenant_id, record.workspace_id, record.target_url,
          record.event_types, record.status, record.consecutive_failures ?? 0,
          record.max_consecutive_failures ?? 5, record.description ?? null,
          record.created_by, record.created_at, record.updated_at,
          record.metadata ?? {},
        ],
      );
      return record;
    },

    async insertSecret(subscriptionId, encrypted, tenantId, workspaceId) {
      await pool.query(
        `INSERT INTO webhook_signing_secrets
           (subscription_id, secret_cipher, secret_iv, status, tenant_id, workspace_id)
         VALUES ($1, $2, $3, 'active', $4, $5)`,
        [subscriptionId, encrypted.cipher, encrypted.iv, tenantId, workspaceId],
      );
    },

    async listSubscriptions(ctx, query = {}) {
      const limit = Math.min(Number(query.limit) || 100, 200);
      const { rows } = await pool.query(
        `SELECT * FROM webhook_subscriptions
          WHERE tenant_id = $1 AND workspace_id = $2 AND deleted_at IS NULL
          ORDER BY created_at DESC
          LIMIT $3`,
        [ctx.tenantId, ctx.workspaceId, limit],
      );
      return rows;
    },

    async getSubscription(id) {
      // No tenant predicate by contract: the action compares row.tenant_id /
      // workspace_id to the caller and returns 404 on mismatch.
      const { rows } = await pool.query(
        `SELECT * FROM webhook_subscriptions WHERE id = $1`,
        [id],
      );
      return rows[0] ?? null;
    },

    async updateSubscription(id, patch) {
      const { rows } = await pool.query(
        `UPDATE webhook_subscriptions
            SET target_url = $2,
                event_types = $3,
                description = COALESCE($4, description),
                metadata = COALESCE($5, metadata),
                updated_at = now()
          WHERE id = $1
        RETURNING *`,
        [id, patch.target_url, patch.event_types, patch.description ?? null, patch.metadata ?? null],
      );
      return rows[0];
    },

    async replaceSubscription(record) {
      const { rows } = await pool.query(
        `UPDATE webhook_subscriptions
            SET status = $2, updated_at = $3, deleted_at = $4
          WHERE id = $1
        RETURNING *`,
        [record.id, record.status, record.updated_at, record.deleted_at ?? null],
      );
      return rows[0];
    },

    async cancelPendingDeliveries(subscriptionId) {
      await pool.query(
        `UPDATE webhook_deliveries
            SET status = 'cancelled', updated_at = now()
          WHERE subscription_id = $1 AND status = 'pending'`,
        [subscriptionId],
      );
    },

    async rotateSecret(subscriptionId, encrypted, graceExpiresAt, tenantId, workspaceId) {
      // Move the current active secret to a time-boxed grace window (tenant-scoped),
      // then issue the new active secret. Verification accepts both during grace.
      await pool.query(
        `UPDATE webhook_signing_secrets
            SET status = 'grace', grace_expires_at = $2
          WHERE subscription_id = $1 AND status = 'active'
            AND tenant_id = $3 AND workspace_id = $4`,
        [subscriptionId, graceExpiresAt, tenantId, workspaceId],
      );
      await pool.query(
        `INSERT INTO webhook_signing_secrets
           (subscription_id, secret_cipher, secret_iv, status, tenant_id, workspace_id)
         VALUES ($1, $2, $3, 'active', $4, $5)`,
        [subscriptionId, encrypted.cipher, encrypted.iv, tenantId, workspaceId],
      );
    },

    async listDeliveries(subscriptionId, query = {}) {
      // The owning subscription is already tenant-checked by the action before this runs.
      const limit = Math.min(Number(query.limit) || 100, 200);
      const { rows } = await pool.query(
        `SELECT * FROM webhook_deliveries
          WHERE subscription_id = $1
          ORDER BY created_at DESC
          LIMIT $2`,
        [subscriptionId, limit],
      );
      return rows;
    },

    async getDelivery(subscriptionId, deliveryId) {
      const { rows } = await pool.query(
        `SELECT * FROM webhook_deliveries WHERE subscription_id = $1 AND id = $2`,
        [subscriptionId, deliveryId],
      );
      return rows[0] ?? null;
    },
  };
}
