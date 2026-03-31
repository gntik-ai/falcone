import { randomUUID } from 'node:crypto';
import { UNLIMITED_SENTINEL, isValidDimensionKey, isValidLimitValue } from './quota-dimension.mjs';

export const VALID_QUOTA_TYPES = new Set(['hard', 'soft']);
export const VALID_OVERRIDE_STATUSES = new Set(['active', 'superseded', 'revoked', 'expired']);
export const MAX_JUSTIFICATION_LENGTH = Number.parseInt(process.env.QUOTA_OVERRIDE_JUSTIFICATION_MAX_LENGTH ?? '1000', 10) || 1000;

export function normalizeQuotaType(value) {
  return value === 'soft' ? 'soft' : 'hard';
}

export function validateQuotaTypeConfigEntry(entry = {}) {
  const quotaType = normalizeQuotaType(entry.type);
  const graceMargin = entry.graceMargin ?? 0;
  if (!Number.isInteger(graceMargin) || graceMargin < 0) throw Object.assign(new Error('Invalid grace margin'), { code: 'INVALID_GRACE_MARGIN' });
  if (quotaType === 'soft' && entry.graceMargin === undefined) throw Object.assign(new Error('Grace margin required'), { code: 'GRACE_MARGIN_REQUIRED_FOR_SOFT' });
  return { type: quotaType, graceMargin };
}

export function normalizeQuotaTypeConfig(config = {}) {
  const normalized = {};
  for (const [dimensionKey, entry] of Object.entries(config ?? {})) {
    if (!isValidDimensionKey(dimensionKey)) throw Object.assign(new Error('Invalid dimension key'), { code: 'INVALID_DIMENSION_KEY' });
    normalized[dimensionKey] = validateQuotaTypeConfigEntry(entry ?? {});
  }
  return normalized;
}

export function assertJustification(value, code = 'JUSTIFICATION_REQUIRED') {
  if (typeof value !== 'string' || !value.trim()) throw Object.assign(new Error('Justification required'), { code });
  if (value.trim().length > MAX_JUSTIFICATION_LENGTH) throw Object.assign(new Error('Justification too long'), { code: 'JUSTIFICATION_TOO_LONG' });
  return value.trim();
}

export function normalizeExpiry(expiresAt) {
  if (expiresAt === null || expiresAt === undefined || expiresAt === '') return null;
  const date = new Date(expiresAt);
  if (Number.isNaN(date.getTime())) throw Object.assign(new Error('Invalid expiration'), { code: 'INVALID_EXPIRATION' });
  if (date.getTime() <= Date.now()) throw Object.assign(new Error('Expiration must be future'), { code: 'EXPIRATION_MUST_BE_FUTURE' });
  return date.toISOString();
}

export class QuotaOverride {
  constructor({ id = randomUUID(), tenantId, dimensionKey, overrideValue, quotaType = 'hard', graceMargin = 0, justification, expiresAt = null, status = 'active', createdBy = 'system', createdAt = new Date().toISOString() } = {}) {
    this.id = id;
    this.tenantId = tenantId;
    this.dimensionKey = dimensionKey;
    this.overrideValue = overrideValue;
    this.quotaType = normalizeQuotaType(quotaType);
    this.graceMargin = graceMargin ?? 0;
    this.justification = justification;
    this.expiresAt = expiresAt;
    this.status = status;
    this.createdBy = createdBy;
    this.createdAt = createdAt;
    this.validate();
  }

  validate() {
    if (!this.tenantId || typeof this.tenantId !== 'string') throw Object.assign(new Error('tenantId required'), { code: 'TENANT_ID_REQUIRED' });
    if (!isValidDimensionKey(this.dimensionKey)) throw Object.assign(new Error('Invalid dimension key'), { code: 'INVALID_DIMENSION_KEY' });
    if (!isValidLimitValue(this.overrideValue)) throw Object.assign(new Error('Invalid override value'), { code: 'INVALID_OVERRIDE_VALUE' });
    if (!VALID_QUOTA_TYPES.has(this.quotaType)) throw Object.assign(new Error('Invalid quota type'), { code: 'INVALID_QUOTA_TYPE' });
    if (!Number.isInteger(this.graceMargin) || this.graceMargin < 0) throw Object.assign(new Error('Invalid grace margin'), { code: 'INVALID_GRACE_MARGIN' });
    if (this.quotaType === 'soft' && this.graceMargin === undefined) throw Object.assign(new Error('Grace margin required'), { code: 'GRACE_MARGIN_REQUIRED_FOR_SOFT' });
    this.justification = assertJustification(this.justification);
    this.expiresAt = this.expiresAt ? normalizeExpiry(this.expiresAt) : null;
    if (!VALID_OVERRIDE_STATUSES.has(this.status)) throw Object.assign(new Error('Invalid status'), { code: 'INVALID_STATUS' });
  }
}

export function isOverrideExpired(record, now = new Date()) {
  return Boolean(record?.expiresAt && new Date(record.expiresAt).getTime() <= now.getTime());
}

export function normalizeOverrideRecord(record = {}) {
  return {
    overrideId: record.overrideId ?? record.id,
    tenantId: record.tenantId ?? record.tenant_id,
    dimensionKey: record.dimensionKey ?? record.dimension_key,
    overrideValue: Number(record.overrideValue ?? record.override_value),
    quotaType: normalizeQuotaType(record.quotaType ?? record.quota_type),
    graceMargin: Number(record.graceMargin ?? record.grace_margin ?? 0),
    justification: record.justification,
    expiresAt: record.expiresAt ?? record.expires_at ?? null,
    status: record.status ?? 'active',
    createdBy: record.createdBy ?? record.created_by,
    createdAt: record.createdAt ?? record.created_at,
    supersededBy: record.supersededBy ?? record.superseded_by ?? null,
    revokedBy: record.revokedBy ?? record.revoked_by ?? null,
    revokedAt: record.revokedAt ?? record.revoked_at ?? null,
    revocationJustification: record.revocationJustification ?? record.revocation_justification ?? null,
    modifiedBy: record.modifiedBy ?? record.modified_by ?? null,
    modifiedAt: record.modifiedAt ?? record.modified_at ?? null,
    modificationJustification: record.modificationJustification ?? record.modification_justification ?? null,
    unlimitedSentinel: Number(record.overrideValue ?? record.override_value) === UNLIMITED_SENTINEL
  };
}
