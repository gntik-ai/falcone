const capabilityFields = ['contextWindow', 'maxOutputTokens', 'streaming', 'structuredOutput',
  'toolUse', 'batch', 'promptCaching', 'inputModalities', 'pricingRef'];

export function catalogEntries(catalog, providerType) {
  return Object.hasOwn(catalog.entries, providerType) ? catalog.entries[providerType] : {};
}

export function mergeModels(connection, rows, catalog) {
  const stored = new Map(rows.map(row => [row.modelId, row]));
  const allowed = new Set(connection.allowedModels);
  const entries = catalogEntries(catalog, connection.providerType);
  return [...new Set([...stored.keys(), ...allowed])].sort().map(modelId => {
    const row = stored.get(modelId);
    const entry = Object.hasOwn(entries, modelId) ? entries[modelId] : undefined;
    const capabilities = Object.fromEntries(capabilityFields.map(field =>
      [field, row?.capabilities?.[field] ?? entry?.capabilities?.[field] ?? null]));
    const state = row?.lifecycle?.state ?? entry?.lifecycle?.state ?? null;
    const retiresAt = row?.lifecycle?.retiresAt ?? entry?.lifecycle?.retiresAt ?? null;
    const manual = capabilityFields.some(field => row?.capabilities?.[field] != null);
    const catalogued = capabilityFields.some(field => entry?.capabilities?.[field] != null);
    return {
      modelId, displayName: row?.displayName ?? entry?.displayName ?? null,
      idSource: row ? 'manual' : 'allowList',
      capabilitySource: manual ? 'manual' : catalogued ? 'catalog' : 'unresolved',
      selectable: allowed.has(modelId), capabilities,
      lifecycle: { state, retiresAt, effectiveState: state === 'retired' || (retiresAt != null && Date.parse(retiresAt) <= Date.now()) ? 'retired' : state },
    };
  });
}

export function validModelId(value) {
  return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/.exec(value)?.[0] === value;
}

export function validModelMetadata(model) {
  if (!model || !validModelId(model.modelId)) return false;
  if (model.displayName != null && (typeof model.displayName !== 'string' || model.displayName.length > 128)) return false;
  for (const field of ['capabilities', 'lifecycle']) {
    if (model[field] != null && (typeof model[field] !== 'object' || Array.isArray(model[field]))) return false;
  }
  for (const [field, value] of Object.entries(model.capabilities ?? {})) {
    if (!capabilityFields.includes(field)) return false;
    if (value == null) continue;
    if (['contextWindow', 'maxOutputTokens'].includes(field)) {
      if (!Number.isSafeInteger(value) || value <= 0) return false;
    } else if (field === 'inputModalities') {
      if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) return false;
    } else if (field === 'pricingRef') {
      if (typeof value !== 'string') return false;
    } else if (typeof value !== 'boolean') return false;
  }
  const lifecycle = model.lifecycle ?? {};
  if (Object.keys(lifecycle).some(field => !['state', 'retiresAt'].includes(field))) return false;
  if (lifecycle.state != null && !['active', 'deprecated', 'retired'].includes(lifecycle.state)) return false;
  if (lifecycle.retiresAt != null && (typeof lifecycle.retiresAt !== 'string' || !/^\d{4}-\d\d-\d\dT/.test(lifecycle.retiresAt) || !Number.isFinite(Date.parse(lifecycle.retiresAt)))) return false;
  return true;
}
