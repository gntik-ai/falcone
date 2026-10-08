## Why

Tenant purge and workspace deletion remove registry rows without destroying the corresponding OpenBao workspace secrets. The material survives all KV versions and loses its product API recovery path when the workspace disappears.

## What Changes

- Recursively list the resolved tenant or workspace prefix, destroy secrets using KV-v2 metadata DELETE, and re-list to verify absence.
- Run secret teardown after the existing runtime cleanup gate and before registry deletion. Return 502 `SECRET_TEARDOWN_INCOMPLETE` with names or unverified prefixes when deletion or verification fails; retain rows so the same authorized request can be retried.
- Add `removed.secrets` and `residual.secrets` to both completion responses. Disclose an unconfigured backend as `residual.secretsBackend: disabled` while allowing purge to proceed.
- Share one process store and Kubernetes-auth provider between function and lifecycle handlers. Bound KV HTTP requests and reject missing or unsafe scope identifiers before contacting OpenBao.

## Non-Goals

No Knative inline secret copies (#970), generic deletion recovery (#967), BYOK credentials (#938), provisioning-orchestrator sweep, historical orphan cleanup, schema migration, or chart policy changes.

## Risks and Rollback

Metadata deletion irreversibly destroys every secret version. Isolation relies on resolved registry identifiers and guarded path segments. An OpenBao outage or policy denial now intentionally blocks registry deletion. Sequential deletion adds latency; batching is out of scope.

Rollback is a control-plane image revert without a chart or schema change. Destroyed secrets remain destroyed after rollback. Before release, verify policy parity with deployment revision `3be423c6`: `workspace-secrets-role` must grant list and delete on `secret/metadata/falcone/workspace-secrets/*`. Historical orphan removal needs a separate human decision and risk classification.

For `SECRET_TEARDOWN_INCOMPLETE`, the `secret_teardown_failure` log event reports the failed operation and upstream HTTP status only. Status `0` means no HTTP status was available, including transport failures or invalid resolved scope. Error messages and upstream response bodies are excluded; retry the same purge or delete request after backend recovery.
