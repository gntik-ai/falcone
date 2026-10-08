# Enforce live tenant quota dimensions

## Problem

Issue #962 reports that only workspace creation resolves catalog quotas at admission.
Live topic, Mongo database and Function creation can exceed their advertised limits;
storage uploads use an unset environment limit instead of governance. Posture reports
also describe capabilities without a live gate as enforced.

## Change

- Resolve `max_kafka_topics`, `max_mongo_databases`, `max_functions` and
  `max_storage_bytes` through the existing override → plan → catalog resolver and
  quota decision model, using the `/repo` dynamic loader and injectable `opts.load`.
- Authorize first, then meter tenant-wide usage before Kafka creation, FerretDB
  collection creation, Knative deployment or S3 object writes/completion.
- Return `402 QUOTA_EXCEEDED` on denial and best-effort write one enforcement record.
  Updates and re-provisioning existing Mongo database names remain available.
- Report `not_enforced` for dimensions without runtime gates; retain the existing
  workspace gate and the independent bucket-count `409 STORAGE_QUOTA_EXCEEDED` gate.

## Implementation decisions

Storage aggregation is per tenant, matching the catalog and acceptance criteria.
Resolved governance values supersede `STORAGE_MAX_BYTES`; it is not an additional
operator ceiling. Legacy synchronous storage helpers and the unavailable-governance
usage-report fallback retain their existing behavior for compatibility. Admission
fails open as `quota_unavailable` on loader, resolver or metering failure. Enforcement
logging remains best-effort and cannot alter the response.

Mongo usage counts distinct database names from the actual
`workspace_mongo_databases` registry, rather than the stale consumption mapping to
PostgreSQL's `workspace_databases`. Function usage includes the separate legacy
`workspace_functions` and live Knative `fn_actions` registries. Topic usage counts
`workspace_topics` across the tenant.

Storage scans follow continuation tokens across every tenant bucket, with a budget
of 100 pages and five seconds for object-store reads. Partial or failed scans are
unavailable meters, never a partial authoritative count. No count cache is retained.
Multipart completion reads actual S3 part sizes before assembly, with at most ten
ListParts pages and five seconds. Denial preserves an existing destination object.
Replacement admission uses the net byte change. Unlimited byte quotas skip admission
scans. Reserved export manifests remain excluded, as in existing storage accounting.

The existing asynchronous Function success contract stays `202`; topic, Mongo and
single object creation stay `201`, and multipart completion stays `200`.

## Release and rollback

Tenants already at or above a resolved limit cannot create additional resources.
Their existing resources remain intact; nothing is deleted. Count-then-create admits
small concurrent overruns, the same governance tradeoff as the workspace gate.
Storage writes/part replacement concurrent with metering have the same race.
Scanning beyond the budget fails open, so this is a governance control rather than
an atomic reservation mechanism.

Rollback restores the prior image. There are no schema, dependency or chart changes;
enforcement-log rows are additive. No deployment, merge or release action belongs to
this ChangeSet.

## Validation

Unit coverage exercises real resolution precedence, raised and lowered plan/override
values, boundaries, unlimited values and unavailable governance/meters. Handler tests
verify tenant counts, denial logs and absence of external writes, plus Function PATCH,
Mongo re-provision, storage replacement, multipart, pagination and ownership regressions.
Mocked 100-page storage scans took approximately 36 ms locally; real S3 latency still
requires runtime measurement. Runtime verification must reproduce the 11th-topic and
third-Mongo refusal and inspect enforcement rows in the release environment.
