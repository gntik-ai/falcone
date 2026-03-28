# Storage Capacity Quota Scenarios

## Section 1 — Tenant capacity exhaustion

| Scenario ID | Precondition | Action | Expected Outcome | Evidence Required |
|---|---|---|---|---|
| SC-TEN-001 | Tenant usage is below `tenant.storage.bytes.max` | Preview an upload with positive byte delta inside the remaining headroom | Decision is allowed | `allowed: true`, empty `violations`, tenant scope status retained |
| SC-TEN-002 | Tenant usage is near `tenant.storage.bytes.max` | Preview an upload whose `byteDelta` pushes total usage above the limit | Decision is denied | `effectiveViolation.dimension=total_bytes`, `reasonCode=CAPACITY_LIMIT_EXCEEDED`, normalized code `STORAGE_QUOTA_EXCEEDED` |

### Evidence expectations — tenant capacity

- Decision payload with tenant scope, used/limit/nextUsed values
- Audit event with `allowed=false` and `effectiveViolation`

## Section 2 — Workspace capacity exhaustion

| Scenario ID | Precondition | Action | Expected Outcome | Evidence Required |
|---|---|---|---|---|
| SC-WS-001 | Workspace limit is stricter than tenant limit | Preview an upload that fits tenant capacity but exceeds workspace capacity | Decision is denied by workspace scope | violation entry with `scope=workspace`, `dimension=total_bytes` |
| SC-WS-002 | Workspace has room | Preview a bounded upload inside workspace remaining capacity | Decision is allowed | empty `violations`, workspace scope preserved |

### Evidence expectations — workspace capacity

- Scope-specific violation data
- Comparison of tenant/workspace limits in `quotaProfile.scopes`

## Section 3 — Bucket-count exhaustion

| Scenario ID | Precondition | Action | Expected Outcome | Evidence Required |
|---|---|---|---|---|
| SC-BKT-001 | Workspace current bucket count is below max | Preview one additional bucket | Decision is allowed | `action=bucket_create`, `allowed=true` |
| SC-BKT-002 | Workspace current bucket count equals max | Preview one additional bucket | Decision is denied | `reasonCode=BUCKET_LIMIT_EXCEEDED`, normalized code `STORAGE_QUOTA_EXCEEDED` |

### Evidence expectations — bucket count

- Bucket-count dimension status (`used`, `limit`, `remaining`)
- Decision payload for `bucket_create`

## Section 4 — Object-count exhaustion

| Scenario ID | Precondition | Action | Expected Outcome | Evidence Required |
|---|---|---|---|---|
| SC-OBJ-001 | Workspace object count below max | Preview upload with `objectDelta=1` | Decision is allowed | `allowed=true` |
| SC-OBJ-002 | Workspace object count at max | Preview upload with `objectDelta=1` | Decision is denied | violation with `dimension=object_count`, `reasonCode=OBJECT_LIMIT_EXCEEDED` |

### Evidence expectations — object count

- Object-count violation record
- Audit event summary referencing object-count failure

## Section 5 — Per-object oversize rejection

| Scenario ID | Precondition | Action | Expected Outcome | Evidence Required |
|---|---|---|---|---|
| SC-SIZE-001 | `maxObjectSizeBytes` is configured | Preview an upload smaller than the limit | Decision is allowed | no object-size violation |
| SC-SIZE-002 | `maxObjectSizeBytes` is configured | Preview an upload larger than the limit | Decision is denied | `reasonCode=OBJECT_SIZE_LIMIT_EXCEEDED`, normalized code `STORAGE_OBJECT_TOO_LARGE` |

### Evidence expectations — object size

- `effectiveViolation.dimension=object_size_bytes`
- `httpStatus=413`

## Section 6 — Multipart completion parity

| Scenario ID | Precondition | Action | Expected Outcome | Evidence Required |
|---|---|---|---|---|
| SC-MP-001 | Multipart completion target size fits quota | Preview object admission with `action=multipart_complete` | Decision is allowed | `action=multipart_complete`, no violations |
| SC-MP-002 | Multipart completion target size exceeds max object size or total bytes | Preview object admission with `action=multipart_complete` | Decision is denied with the same guardrails as direct upload | matching violation codes and dimensions |

### Evidence expectations — multipart parity

- Decision payload for `multipart_complete`
- Same normalized code mapping as direct upload

## Section 7 — Overwrite/delete negative-delta behavior

| Scenario ID | Precondition | Action | Expected Outcome | Evidence Required |
|---|---|---|---|---|
| SC-NEG-001 | Existing object will be replaced by a smaller one | Preview object admission with negative `byteDelta` | Decision remains allowed | `allowed=true`, empty violations |
| SC-NEG-002 | Delete-style preview reduces object count and bytes | Preview object admission with negative `byteDelta` and negative `objectDelta` | Decision remains allowed | `action=object_delete`, empty violations |

### Evidence expectations — negative deltas

- Negative delta retained in request path
- No false-positive quota violation

## Section 8 — Audit evidence

| Scenario ID | Precondition | Action | Expected Outcome | Evidence Required |
|---|---|---|---|---|
| SC-AUD-001 | Allowed decision exists | Build quota audit event | Safe allow event produced | `eventType=storage.quota.guardrail.evaluated`, `allowed=true`, `violationCount=0` |
| SC-AUD-002 | Denied decision exists | Build quota audit event | Safe deny event produced | `effectiveViolation` summary present, no `http://`, `https://`, or `secret://` substrings |

### Evidence expectations — audit

- Sanitized audit event JSON
- Correlation and actor references preserved without credential leakage

## Review triggers

Re-review this matrix when any of the following occurs:
- tenant or workspace storage quota dimensions change,
- provider-level numeric object-size constraints are introduced,
- storage error taxonomy changes,
- multipart completion semantics change,
- runtime usage snapshots or quota sources change.
