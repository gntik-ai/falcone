import { EVENT_CATALOGUE } from '../src/event-catalogue.mjs';
import { subscriptionCreatedEvent, subscriptionDeletedEvent, subscriptionPausedEvent, subscriptionResumedEvent, subscriptionUpdatedEvent, secretRotatedEvent } from '../src/webhook-audit.mjs';
import { buildSubscriptionRecord, applyStatusTransition, softDelete, validateSubscriptionInput } from '../src/webhook-subscription.mjs';
import { checkSubscriptionQuota, getQuotaConfig } from '../src/webhook-quota.mjs';
import { decryptSecret, encryptSecret, generateSigningSecret } from '../src/webhook-signing.mjs';

function ok(statusCode, body) { return { statusCode, body }; }
function noContent() { return { statusCode: 204, body: null }; }
function error(statusCode, code, message) { return { statusCode, body: { code, message } }; }

// Subscription and delivery ids are Postgres `uuid` columns. A path id that is
// not a well-formed UUID would reach `WHERE id = $1` and make Postgres raise
// SQLSTATE 22P02 (`invalid input syntax for type uuid`), which — with no
// try/catch on the by-id read path — bubbles to the control-plane central catch
// as a generic 500. Reject a malformed id up front so it is treated exactly like
// a nonexistent id (404), never a 500, and never reaches the db. Same predicate
// idiom as apps/control-plane/b-handlers.mjs::isPlanUuid.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isUuid(id) { return UUID_RE.test(String(id ?? '')); }

/**
 * App-layer consistency guard: a signing-secret record (or its parent
 * subscription) must carry a non-empty tenant_id/workspace_id before any secret
 * is persisted. The per-row predicate that enforces tenant scoping at read time
 * lives in the injected db layer (SQL out of source); this guard prevents an
 * un-scoped or tenant-mismatched secret from ever being written in the first
 * place. Throws a 400-mapped error (caught by the create handler) on violation.
 */
function assertTenantScoped(record, expectedTenantId) {
  if (!record || typeof record.tenant_id !== 'string' || record.tenant_id.length === 0) {
    const err = new Error('Signing secret requires a tenant_id');
    err.code = 'TENANT_SCOPE_REQUIRED';
    throw err;
  }
  if (typeof record.workspace_id !== 'string' || record.workspace_id.length === 0) {
    const err = new Error('Signing secret requires a workspace_id');
    err.code = 'TENANT_SCOPE_REQUIRED';
    throw err;
  }
  if (expectedTenantId !== undefined && record.tenant_id !== expectedTenantId) {
    const err = new Error('Signing secret tenant_id does not match the subscription tenant_id');
    err.code = 'TENANT_SCOPE_MISMATCH';
    throw err;
  }
}

function pathParts(path) {
  return String(path || '').replace(/^\/v1\/webhooks\/?/, '').split('/').filter(Boolean);
}

async function publish(kafka, topic, message) {
  if (kafka?.publish) await kafka.publish(topic, message);
}

function responseSubscription(row) {
  return {
    subscriptionId: row.id,
    targetUrl: row.target_url,
    eventTypes: row.event_types,
    description: row.description ?? null,
    status: row.status,
    consecutiveFailures: row.consecutive_failures,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

async function requireSubscription(db, ctx, id) {
  // A non-UUID id can never match a `uuid` primary key; short-circuit to the
  // not-found path (the caller maps a null result to 404) so the malformed value
  // never reaches `db.getSubscription` and cannot raise a 22P02-induced 500. A
  // malformed id is thus indistinguishable from a nonexistent-but-valid one and
  // from a cross-tenant one — consistent with the existing no-existence-disclosure
  // design (no new malformed-vs-absent oracle). Covers every by-id route
  // (GET/PATCH/DELETE/pause/resume/rotate-secret/deliveries) at this chokepoint.
  if (!isUuid(id)) return null;
  const row = await db.getSubscription(id);
  if (!row || row.tenant_id !== ctx.tenantId || row.workspace_id !== ctx.workspaceId || row.deleted_at) return null;
  return row;
}

export async function main(params) {
  const { db, kafka, env = process.env, method = 'GET', path = '/', body = {}, query = {}, auth = {}, resolver } = params;
  const ctx = { tenantId: auth.tenantId, workspaceId: auth.workspaceId, actorId: auth.actorId, resolver };
  const parts = pathParts(path);
  const quotaConfig = getQuotaConfig(env);
  const signingKey = env.WEBHOOK_SIGNING_KEY ?? 'development-signing-key';

  if (method === 'GET' && parts[0] === 'event-types') return ok(200, { eventTypes: EVENT_CATALOGUE });

  if (parts[0] !== 'subscriptions') return error(404, 'NOT_FOUND', 'Route not found');

  if (method === 'POST' && parts.length === 1) {
    try {
      const currentCount = await db.getWorkspaceSubscriptionCount(ctx.tenantId, ctx.workspaceId);
      if (!checkSubscriptionQuota(ctx.workspaceId, currentCount, quotaConfig.maxSubscriptionsPerWorkspace).allowed) {
        return error(409, 'QUOTA_EXCEEDED', 'Workspace subscription quota reached');
      }
      const record = await buildSubscriptionRecord(body, ctx);
      // Consistency guard: a signing secret must never be persisted without the
      // tenant dimension that scopes it. The deployed db layer applies an
      // AND tenant_id = $N AND workspace_id = $M predicate to every secret read;
      // a secret created without a tenant_id would be unreachable (or, worse,
      // reachable cross-tenant). Fail closed before any secret is written.
      assertTenantScoped(record);
      const signingSecret = generateSigningSecret();
      const encrypted = encryptSecret(signingSecret, signingKey);
      await db.insertSubscription(record);
      // Thread tenant_id/workspace_id so the db layer can scope the INSERT and
      // every subsequent read by (tenant_id, workspace_id), not subscription_id alone.
      await db.insertSecret(record.id, encrypted, record.tenant_id, record.workspace_id);
      await publish(kafka, 'console.webhook.subscription.created', subscriptionCreatedEvent(ctx, record.id));
      return ok(201, { ...responseSubscription(record), signingSecret });
    } catch (caught) {
      return error(400, caught.code ?? 'BAD_REQUEST', caught.message);
    }
  }

  if (method === 'GET' && parts.length === 1) {
    const rows = await db.listSubscriptions(ctx, query);
    return ok(200, { items: rows.map(responseSubscription), nextCursor: null });
  }

  const subscriptionId = parts[1];
  const subscription = await requireSubscription(db, ctx, subscriptionId);
  if (!subscription) return error(404, 'NOT_FOUND', 'Subscription not found');

  if (method === 'GET' && parts.length === 2) return ok(200, responseSubscription(subscription));

  if (method === 'PATCH' && parts.length === 2) {
    try {
      const validated = await validateSubscriptionInput({ targetUrl: body.targetUrl ?? subscription.target_url, eventTypes: body.eventTypes ?? subscription.event_types }, { resolver });
      const updated = await db.updateSubscription(subscription.id, { ...body, target_url: validated.targetUrl, event_types: validated.eventTypes });
      await publish(kafka, 'console.webhook.subscription.updated', subscriptionUpdatedEvent(ctx, subscription.id));
      return ok(200, responseSubscription(updated));
    } catch (caught) {
      return error(400, caught.code ?? 'BAD_REQUEST', caught.message);
    }
  }

  if (method === 'POST' && parts[2] === 'pause') {
    try {
      const updated = await db.replaceSubscription(applyStatusTransition(subscription, 'paused'));
      await publish(kafka, 'console.webhook.subscription.paused', subscriptionPausedEvent(ctx, subscription.id));
      return ok(200, responseSubscription(updated));
    } catch (caught) {
      return error(409, caught.code ?? 'INVALID_STATUS_TRANSITION', caught.message);
    }
  }

  if (method === 'POST' && parts[2] === 'resume') {
    try {
      const updated = await db.replaceSubscription(applyStatusTransition(subscription, 'active'));
      await publish(kafka, 'console.webhook.subscription.resumed', subscriptionResumedEvent(ctx, subscription.id));
      return ok(200, responseSubscription(updated));
    } catch (caught) {
      return error(409, caught.code ?? 'INVALID_STATUS_TRANSITION', caught.message);
    }
  }

  if (method === 'DELETE' && parts.length === 2) {
    const deleted = await db.replaceSubscription(softDelete(subscription));
    await db.cancelPendingDeliveries(subscription.id);
    await publish(kafka, 'console.webhook.subscription.deleted', subscriptionDeletedEvent(ctx, subscription.id));
    return noContent(deleted);
  }

  if (method === 'POST' && parts[2] === 'rotate-secret') {
    const gracePeriodSeconds = Number(body.gracePeriodSeconds ?? env.WEBHOOK_SECRET_GRACE_PERIOD_SECONDS ?? 86400);
    const newSigningSecret = generateSigningSecret();
    const encrypted = encryptSecret(newSigningSecret, signingKey);
    const graceExpiresAt = new Date(Date.now() + (gracePeriodSeconds * 1000)).toISOString();
    // Scope rotation to the owning tenant so only rows where tenant_id matches
    // the subscription are rotated/invalidated by the db layer's predicate.
    await db.rotateSecret(subscription.id, encrypted, graceExpiresAt, subscription.tenant_id, subscription.workspace_id);
    await publish(kafka, 'console.webhook.secret.rotated', secretRotatedEvent(ctx, subscription.id));
    return ok(200, { newSigningSecret, gracePeriodSeconds, graceExpiresAt });
  }

  if (method === 'GET' && parts[2] === 'deliveries' && parts.length === 3) {
    const rows = await db.listDeliveries(subscription.id, query);
    return ok(200, { items: rows, nextCursor: null });
  }

  if (method === 'GET' && parts[2] === 'deliveries' && parts.length === 4) {
    // `webhook_deliveries.id` is a uuid column too; a malformed deliveryId would
    // raise 22P02 in `db.getDelivery` (`... AND id = $2`). Treat it as not found,
    // matching the existing nonexistent-delivery 404, before touching the db.
    if (!isUuid(parts[3])) return error(404, 'NOT_FOUND', 'Delivery not found');
    const delivery = await db.getDelivery(subscription.id, parts[3]);
    if (!delivery) return error(404, 'NOT_FOUND', 'Delivery not found');
    return ok(200, delivery);
  }

  return error(404, 'NOT_FOUND', 'Route not found');
}

export function revealSecretRecords(secretRows, env = process.env) {
  const signingKey = env.WEBHOOK_SIGNING_KEY ?? 'development-signing-key';
  return secretRows.map((row) => ({ ...row, secret: decryptSecret(row.secret_cipher, row.secret_iv, signingKey) }));
}
