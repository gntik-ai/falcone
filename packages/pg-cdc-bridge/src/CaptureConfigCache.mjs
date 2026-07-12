export class CaptureConfigCache {
  constructor({ pool, ttlSeconds = Number(process.env.PG_CDC_CACHE_TTL_SECONDS ?? 30) }) { this.pool = pool; this.ttlSeconds = ttlSeconds; this._cache = new Map(); }
  async getActiveConfigs(dataSourceRef, tenantId) {
    const now = Date.now();
    const cacheKey = `${tenantId}:${dataSourceRef}`;
    const cached = this._cache.get(cacheKey);
    if (cached && cached.expiresAt > now) return cached.rows;
    try {
      const { rows } = await this.pool.query(`SELECT * FROM pg_capture_configs WHERE data_source_ref = $1 AND tenant_id = $2 AND status = 'active'`, [dataSourceRef, tenantId]);
      this._cache.set(cacheKey, { rows, expiresAt: now + this.ttlSeconds * 1000 });
      return rows;
    } catch (error) {
      console.error(`[CaptureConfigCache] reload failed: ${error.message}`);
      return cached?.rows ?? [];
    }
  }
  invalidate(dataSourceRef, tenantId) {
    if (tenantId !== undefined) {
      this._cache.delete(`${tenantId}:${dataSourceRef}`);
    } else {
      // legacy: delete all keys for this dataSourceRef
      for (const key of this._cache.keys()) {
        if (key.endsWith(`:${dataSourceRef}`)) this._cache.delete(key);
      }
    }
  }
}
