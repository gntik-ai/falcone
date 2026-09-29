## Why

The control plane caches a Kubernetes-auth OpenBao token until near expiry without renewing it. A broken auth mount can remain invisible for a full 24-hour lease and then make workspace-secret routes fail at once.

## What Changes

- Start Kubernetes auth when the provider is created and renew renewable tokens after half the lease.
- Re-login before expiry when renewal fails or cannot extend the lease; retry failed logins with bounded jittered backoff.
- On a KV 403 for a provider token, invalidate it, re-login, and retry that KV request once.
- Expose read-only secret-backend state in health responses and Prometheus metrics, with sanitized transition logs.

## Non-Goals

- No chart, OpenBao role or policy, static token renewal, secret route status/error code, or write-only value contract change.
- No readiness status change for a secrets-only outage; Postgres still determines the HTTP status.

## Risks and Rollback

This changes the secret credential lifecycle. A failed auth mount now reports degradation promptly. Rollback is a source image revert; no data migration or chart change is required.
