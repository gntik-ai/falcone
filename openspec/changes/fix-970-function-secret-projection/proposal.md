## Why

Issue #970 shows resolved workspace secrets copied into lower-privilege Knative workload objects.
Lost declarations also hide consumers, preventing rotation, revocation and lifecycle cleanup.

## What Changes

- Project only declared OpenBao values into an owned Secret per Function; inject env by reference.
- Persist names/mappings in additive action and version columns and report consuming Function IDs.
- Propagate rotation/revocation, prune legacy inline Revisions, and retain retryable cleanup ownership.
- Provide dry-run namespace discovery and explicitly applied, scoped remediation.
- Preserve an existing Function's registry, versions and lifecycle when redeployment fails.
- Publish declaration aliases and bodyless DELETE impact headers in the OpenAPI contract.

## Scope and Risk

R3. Source changes cover Functions, the secret lifecycle, remediation, tests and documentation.
The paired deployment repository supplies minimal namespace-scoped Secret and workload RBAC.
OpenBao remains authoritative; Secrets are derived projections. Hosted MCP gains no secret support.
No deployment, cluster remediation, BYOK flow or cluster-wide permission change is included.

Reverting RBAC fails closed. Reverting to the old image can inline values on the next deploy;
coordinate rollback and remediation. Running processes may retain old values until their pods exit.
