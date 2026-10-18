// Provider-neutral state machine. Driver I/O is always guarded by the snapshot caller.
import { randomUUID } from 'node:crypto';
import { BatchLeaseLost } from './llm-batch-store.mjs';

export function batchPollInterval(value = process.env.LLM_BATCH_POLL_INTERVAL_MS) {
  const n = Number(value);
  return value !== undefined && value !== '' && Number.isFinite(n) ? Math.min(600000, Math.max(10000, n)) : 60000;
}
export function createLlmBatchReconciler({ store, usageStore, call, driverResolver, now = Date.now, intervalMs, logger = console }) {
  const interval = batchPollInterval(intervalMs);
  const owner = randomUUID();
  let timer, running;
  const timestamp = () => new Date(now()).toISOString();
  const schedule = (ms = interval) => ({ nextPollAt: new Date(now() + ms).toISOString(), updatedAt: timestamp(), leaseOwner: null, leaseExpiresAt: null });

  async function reconcile(row) {
    const driver = driverResolver(row.providerType);
    if (row.status === 'submitting' || row.status === 'submit_uncertain') {
      const deadline = row.status === 'submitting' ? 300000 : 900000;
      // Optional resolution never invokes the creating call. Anthropic cannot resolve a lost id.
      if (driver?.resolveUncertain) {
        const resolved = await call(row, 'resolveUncertain');
        if (resolved?.type === 'accepted') {
          await store.update(row, { status: row.cancelRequestedAt ? 'canceling' : 'in_progress', providerBatchId: resolved.providerBatchId,
            expiresAt: resolved.expiresAt ?? null, ...schedule() });
          return;
        }
      }
      if (now() - Date.parse(row.createdAt) >= deadline) await store.update(row, { status: 'failed', lastErrorCode: 'LLM_BATCH_SUBMIT_UNCERTAIN', ...schedule() });
      else await store.update(row, schedule());
      return;
    }
    if (!row.endedAt && row.expiresAt && now() - Date.parse(row.expiresAt) >= 86400000) {
      await store.update(row, { status: 'failed', lastErrorCode: 'LLM_BATCH_RECONCILE_TIMEOUT', ...schedule() }); return;
    }
    if (row.endedAt && (row.resultsAttempts >= 10 || now() - Date.parse(row.endedAt) >= 86400000)) {
      await store.finish(row, { status: 'incomplete', ...schedule() }, true); return;
    }
    let polled = await call(row, 'poll');
    if (row.cancelRequestedAt && !row.cancelAcknowledgedAt && !polled.cancelAcknowledged && !polled.ended) {
      polled = await call(row, 'cancel');
    }
    row = await store.update(row, { providerCounts: polled.counts,
      cancelAcknowledgedAt: polled.cancelAcknowledged ? row.cancelAcknowledgedAt ?? timestamp() : row.cancelAcknowledgedAt, expiresAt: polled.expiresAt ?? row.expiresAt,
      endedAt: polled.ended ? polled.endedAt ?? row.endedAt ?? timestamp() : row.endedAt, updatedAt: timestamp() });
    if (!polled.ended) { await store.update(row, schedule()); return; }
    let ingestionError, attempted = false;
    try {
      const response = await call(row, 'results');
      row = await store.update(row, { resultsAttempts: row.resultsAttempts + 1, updatedAt: timestamp() });
      attempted = true;
      const ids = new Set((await store.allItems(row.workspaceId, row.batchId, row.tenantId)).map(i => i.customId));
      for await (const line of response.lines) {
        await store.ingest(row, driver.parseResultLine(line, ids), usageStore);
      }
    } catch (error) {
      if (error instanceof BatchLeaseLost) throw error;
      if (!attempted && !['BYOK_ENDPOINT_BLOCKED', 'LLM_PROVIDER_SECRET_UNRESOLVED'].includes(error.code)) {
        row = await store.update(row, { resultsAttempts: row.resultsAttempts + 1, updatedAt: timestamp() });
      }
      ingestionError = error;
    }
    const items = await store.allItems(row.workspaceId, row.batchId, row.tenantId);
    const counts = {};
    for (const item of items) counts[item.status] = (counts[item.status] ?? 0) + 1;
    if (!ingestionError && !counts.pending && items.length === row.requestCount && driver.countsMatch(row.providerCounts, counts)) {
      await store.finish(row, { status: row.cancelAcknowledgedAt ? 'cancelled' : polled.expired || counts.expired === row.requestCount ? 'expired' : 'completed', ...schedule() });
    } else if (row.resultsAttempts >= 10 || now() - Date.parse(row.endedAt) >= 86400000) {
      await store.finish(row, { status: 'incomplete', ...schedule(), ...(ingestionError ? { lastErrorCode: ingestionError.code ?? 'LLM_PROVIDER_RESPONSE_INVALID' } : {}) }, true);
    } else {
      if (ingestionError) throw ingestionError;
      await store.update(row, schedule());
    }
  }
  async function runOnce(filter = {}) {
    const rows = await store.claim({ now: now(), owner, ...filter });
    for (const row of rows) {
      try { await reconcile(row); }
      catch (error) {
        if (error instanceof BatchLeaseLost) continue;
        const previous = Math.max(interval, Date.parse(row.nextPollAt) - Date.parse(row.updatedAt));
        const delay = error.statusCode === 429 || error.httpStatus >= 500 || error.statusCode === 503
          ? Math.min(600000, previous * 2) : error.statusCode === 424 || ['BYOK_ENDPOINT_BLOCKED', 'LLM_PROVIDER_SECRET_UNRESOLVED'].includes(error.code) ? 600000 : interval;
        try { await store.update(row, { lastErrorCode: error.code ?? 'LLM_PROVIDER_ERROR', ...schedule(delay) }); }
        catch (writeError) { if (!(writeError instanceof BatchLeaseLost)) throw writeError; }
      }
    }
    return rows.length;
  }
  return {
    runOnce,
    start() {
      if (timer) return;
      const tick = () => {
        if (running) return;
        running = runOnce().catch(error => logger.error?.('[llm-batches] reconcile failed', { code: error.code ?? 'LLM_BATCH_ERROR' })).finally(() => { running = null; });
      };
      timer = setInterval(tick, interval); timer.unref?.(); tick();
    },
    async stop() { if (timer) clearInterval(timer); timer = null; await running; },
  };
}
