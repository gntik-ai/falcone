import { randomUUID } from 'node:crypto';

export class WorkspaceSubQuota {
  constructor({ id = randomUUID(), tenantId, workspaceId, dimensionKey, allocatedValue, createdBy = 'system', updatedBy = createdBy, createdAt = new Date().toISOString(), updatedAt = createdAt } = {}) {
    this.id = id;
    this.tenantId = tenantId;
    this.workspaceId = workspaceId;
    this.dimensionKey = dimensionKey;
    this.allocatedValue = allocatedValue;
    this.createdBy = createdBy;
    this.updatedBy = updatedBy;
    this.createdAt = createdAt;
    this.updatedAt = updatedAt;
    this.validate();
  }

  validate() {
    validateDimensionKey(this.dimensionKey);
    validateSubQuotaValue(this.allocatedValue);
    if (!this.tenantId || typeof this.tenantId !== 'string') throw Object.assign(new Error('tenantId required'), { code: 'TENANT_ID_REQUIRED' });
    if (!this.workspaceId || typeof this.workspaceId !== 'string') throw Object.assign(new Error('workspaceId required'), { code: 'WORKSPACE_ID_REQUIRED' });
    if (!this.createdBy || typeof this.createdBy !== 'string') throw Object.assign(new Error('createdBy required'), { code: 'CREATED_BY_REQUIRED' });
    if (!this.updatedBy || typeof this.updatedBy !== 'string') throw Object.assign(new Error('updatedBy required'), { code: 'UPDATED_BY_REQUIRED' });
  }
}

export function validateSubQuotaValue(value) {
  if (!Number.isInteger(value) || value < 0 || value === -1) {
    throw Object.assign(new Error('Invalid sub-quota value'), { code: 'INVALID_SUB_QUOTA_VALUE' });
  }
  return value;
}

export function validateDimensionKey(key) {
  if (!key || typeof key !== 'string') {
    throw Object.assign(new Error('Invalid dimension key'), { code: 'INVALID_DIMENSION_KEY' });
  }
  return key;
}

export function fromRow(row = {}) {
  return new WorkspaceSubQuota({
    id: row.id,
    tenantId: row.tenantId ?? row.tenant_id,
    workspaceId: row.workspaceId ?? row.workspace_id,
    dimensionKey: row.dimensionKey ?? row.dimension_key,
    allocatedValue: Number(row.allocatedValue ?? row.allocated_value),
    createdBy: row.createdBy ?? row.created_by,
    updatedBy: row.updatedBy ?? row.updated_by,
    createdAt: row.createdAt ?? row.created_at,
    updatedAt: row.updatedAt ?? row.updated_at
  });
}
