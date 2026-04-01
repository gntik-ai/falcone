# Data Model — US-BKP-02-T03

## 1. Overview

This feature introduces two persistent entities in PostgreSQL and several transient API/domain objects:

- **Config Reprovision Audit Log**: metadata-only audit record for every reaprovisionamiento request.
- **Tenant Config Reprovision Lock**: concurrency lock per destination tenant.
- **Identifier Map**: transient mapping used to rewrite tenant-specific identifiers before appliers run.
- **Reprovision Result**: transient per-domain/per-resource execution result.

The exported artifact itself is **never stored**; only hashes, summary metadata, and outcome details are persisted.

---

## 2. Persistent entities

### 2.1 `config_reprovision_audit_log`

Purpose: store an immutable summary of every request, including dry-run attempts, partial successes, failures, and map-generation invocations.

Recommended fields:

| Field | Type | Notes |
|---|---|---|
| `id` | UUID PK | Generated server-side |
| `tenant_id` | TEXT | Destination tenant |
| `source_tenant_id` | TEXT | Source tenant from artifact metadata |
| `actor_id` | TEXT | User email or service account |
| `actor_type` | TEXT | Enum: `superadmin`, `sre`, `service_account` |
| `dry_run` | BOOLEAN | `true` for simulation-only requests |
| `requested_domains` | TEXT[] | Domains requested by the operator |
| `effective_domains` | TEXT[] | Domains actually processed after filtering/availability checks |
| `identifier_map_hash` | TEXT | SHA-256 digest of the final identifier map used |
| `artifact_checksum` | TEXT | Hash of the input artifact payload or schema checksum + canonicalized body digest |
| `format_version` | TEXT | Artifact format version validated before execution |
| `result_status` | TEXT | Enum: `success`, `partial`, `failed`, `blocked`, `dry_run` |
| `domain_summary` | JSONB | Per-domain counts and statuses |
| `resource_summary` | JSONB | Aggregate counts for created/skipped/conflict/error |
| `correlation_id` | TEXT | Trace/correlation id from gateway or caller |
| `started_at` | TIMESTAMPTZ | Request start time |
| `ended_at` | TIMESTAMPTZ | Request end time |
| `error_detail` | TEXT NULL | High-level failure message when applicable |

Suggested constraints:

- `tenant_id`, `source_tenant_id`, `actor_id`, `result_status`, `correlation_id`, `started_at`, `ended_at` are required.
- No full artifact payload column.
- `domain_summary` and `resource_summary` must be JSON objects, not arrays of opaque strings.

Suggested indexes:

- `(tenant_id, started_at DESC)`
- `(source_tenant_id, started_at DESC)`
- `(correlation_id)`
- `(actor_id, started_at DESC)`

### 2.2 `tenant_config_reprovision_locks`

Purpose: prevent concurrent reaprovisionamientos on the same destination tenant and provide TTL-based recovery.

Recommended fields:

| Field | Type | Notes |
|---|---|---|
| `tenant_id` | TEXT PK | One active lock row per tenant |
| `lock_token` | UUID | Opaque token generated on acquire |
| `actor_id` | TEXT | Who acquired the lock |
| `actor_type` | TEXT | Role class |
| `source_tenant_id` | TEXT | Source tenant from the artifact |
| `dry_run` | BOOLEAN | Whether the current run is a dry-run |
| `correlation_id` | TEXT | Request correlation id |
| `status` | TEXT | Enum: `active`, `released`, `expired`, `failed` |
| `acquired_at` | TIMESTAMPTZ | Lock acquisition timestamp |
| `expires_at` | TIMESTAMPTZ | Lock timeout deadline |
| `released_at` | TIMESTAMPTZ NULL | Set when lock is explicitly released |
| `last_heartbeat_at` | TIMESTAMPTZ NULL | Optional heartbeat if the action refreshes long-running locks |
| `error_detail` | TEXT NULL | Populated when the lock holder fails before release |

Suggested constraints:

- `tenant_id` unique/primary key.
- `expires_at > acquired_at`.
- Expired locks can be reclaimed if `expires_at < NOW()` and `status != 'active'`.

Suggested indexes:

- `(status, expires_at)` for cleanup sweeps.
- `(correlation_id)` for traceability.

---

## 3. Transient API/domain entities

### 3.1 `ExportArtifact`

The input artifact from T01/T02.

Relevant fields for this feature:

- `export_timestamp`
- `tenant_id` (source tenant)
- `format_version`
- `deployment_profile`
- `correlation_id`
- `domains[]` with `domain_key`, `status`, `data`, `items_count`, `error`, `reason`

Validation rules:

- Must pass T02 validation before reprovision.
- Current major must match the platform-supported major.
- Domains with `error`, `not_available`, or `not_requested` are not applied.

### 3.2 `IdentifierMap`

A normalized mapping used to rewrite artifact text before appliers run.

Recommended shape:

```json
{
  "source_tenant_id": "tenant-stg",
  "target_tenant_id": "tenant-prod",
  "entries": [
    { "from": "stg-abc", "to": "prod-xyz", "scope": "iam.realm" },
    { "from": "stg_abc", "to": "prod_xyz", "scope": "postgres.schema" },
    { "from": "stg.abc.", "to": "prod.xyz.", "scope": "kafka.topic_prefix" }
  ],
  "overrides": {
    "functions.namespace": "tenant-prod-fns"
  }
}
```

Validation rules:

- `from` and `to` must be non-empty strings.
- Duplicate `from` keys are rejected.
- Longest `from` values must be applied first to avoid substring collisions.
- Empty or invalid `to` values cause a `400` before any applier runs.

### 3.3 `ReprovisionRequestEnvelope`

API request body for the main endpoint.

```json
{
  "artifact": { /* ExportArtifact */ },
  "identifier_map": { /* IdentifierMap override or confirmed proposal */ },
  "domains": ["iam", "postgres_metadata"],
  "dry_run": false
}
```

Validation rules:

- `artifact` required.
- `dry_run` defaults to `false`.
- If `domains` is omitted, all exportable domains with `ok` or `empty` status are eligible.
- Domains in `not_available`, `error`, or `not_requested` are always skipped.

### 3.4 `ReprovisionResult`

Transient response returned by the main action.

Top-level fields:

- `tenant_id`
- `source_tenant_id`
- `dry_run`
- `status` (`success`, `partial`, `failed`, `blocked`, `dry_run`)
- `lock`
- `identifier_map`
- `domain_results[]`
- `summary`
- `warnings[]`
- `correlation_id`

### 3.5 `ReprovisionDomainResult`

Per-domain status.

Allowed statuses:

- `applied`
- `applied_with_warnings`
- `skipped`
- `skipped_not_exportable`
- `skipped_no_applier`
- `conflict`
- `error`
- `would_apply` / `would_conflict` / `would_skip` when `dry_run=true`

### 3.6 `ReprovisionResourceResult`

Per-resource status inside a domain.

Allowed actions:

- `created`
- `skipped`
- `conflict`
- `error`
- `applied_with_warnings`
- `would_create`
- `would_skip`
- `would_conflict`

Fields:

- `resource_type`
- `resource_name`
- `resource_id` (if the subsystem provides one)
- `action`
- `message`
- `diff` (optional structured diff for conflicts)
- `warnings[]`

---

## 4. State transitions

### 4.1 Lock lifecycle

```text
none → active → released
                 ↘ failed
                 ↘ expired
```

Rules:

- The lock is acquired before any applier runs.
- The lock is released on successful completion, partial completion, or handled failure.
- If the action crashes or times out, cleanup relies on `expires_at`.

### 4.2 Reprovision request lifecycle

```text
received → validated → locked → applying → completed
                ↘ rejected (422/400)
                ↘ blocked (409)
                ↘ dry_run_complete
```

Domain-level transitions:

```text
pending → applied | applied_with_warnings | skipped | conflict | error | skipped_not_exportable | skipped_no_applier
```

---

## 5. Cross-entity relationships

- One `ExportArtifact` can produce one `ReprovisionRequestEnvelope`.
- One reprovision request writes one audit record.
- One reprovision request may touch zero or more domains and zero or more resources per domain.
- One tenant has at most one active lock at a time.

---

## 6. Validation notes

- Preserve the artifact in memory only; never persist the full JSON blob.
- Store digests/hashes instead of raw secrets or raw payloads.
- Validate identifier replacement before appliers run and again after transformation to ensure no origin token remains in fields that should have been rewritten.
- Keep conflict detection conservative: prefer `conflict` over silent overwrite.
