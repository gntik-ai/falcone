# fix-temporal-secret-password-substitution

## Change type
bugfix

## Capability
deployment

## Priority
P2

## Why
The chart's secure way to supply Temporal's PostgreSQL password —
`temporal.persistence.existingSecret` + `passwordSecretKey` — does not work, and the only working
alternative leaks the credential. GitHub issue #623.

**Root cause (code-verified).** `charts/in-falcone/templates/temporal/config.yaml` rendered
`password: {{ $p.password | quote }}` for both datastores. With the documented secret pattern the
operator sets `password: "${POSTGRES_PWD}"`, so the ConfigMap renders the literal string
`password: "${POSTGRES_PWD}"`. The deployed `temporalio/server` pods run no env-substitution step
(no dockerize/auto-setup) — the file comment itself notes "the plain temporalio/server image does NOT
template the config with env vars at load time" — so the literal `${POSTGRES_PWD}` is sent as the
password and auth fails. The Temporal server pods crash-loop:
`sql schema version compatibility check failed: ... no usable database connection found`. The
env-based schema-bootstrap Job (which reads `POSTGRES_PWD` from env via `temporal-sql-tool`)
connects fine — the asymmetry that proves the config-file path is the broken one.

The only working alternative — inline `persistence.password` — renders the real DB password into an
inspectable ConfigMap (credential leak). So an operator must choose between **broken Temporal**
(secretKeyRef) or **a leaked credential** (inline) whenever the Postgres password is non-default
(e.g. `tests/live-campaign/make-secrets.sh` generates one).

The chart ALREADY has a server start wrapper (`deployments.yaml`) that copies the read-only ConfigMap
into a writable dir and `sed`-substitutes `__BROADCAST_ADDRESS__` / `__BIND_IP__` from the pod IP
before `exec`-ing the entrypoint — the exact seam needed to also substitute the password.

## What Changes
- `charts/in-falcone/templates/temporal/config.yaml`: when `persistence.existingSecret` is set,
  render the datastore `password` as a literal `"__TEMPORAL_DB_PASSWORD__"` placeholder (for BOTH the
  default and visibility stores) instead of the plaintext or the unexpanded `${POSTGRES_PWD}` — so a
  plaintext password NEVER appears in the ConfigMap. With no `existingSecret` the inline password is
  rendered as before (dev/sandbox default unchanged). The stale comment claiming "the SQL driver
  expands ${...}" is corrected to describe the placeholder + wrapper substitution.
- `charts/in-falcone/templates/temporal/deployments.yaml`: extend the existing start-wrapper `sed`
  to also substitute `__TEMPORAL_DB_PASSWORD__` from the `POSTGRES_PWD` env (already injected via
  `secretKeyRef` by `in-falcone.temporal.persistenceEnv`). The replacement value is `sed`-escaped
  (`& / \`) so any generated password is injected literally, and the password lands ONLY in the
  writable in-pod copy of the config — never in the ConfigMap.

## Impact
- `temporal.persistence.existingSecret` now works: the frontend/history/matching pods authenticate
  and start (no `no usable database connection`) with a generated/non-default Postgres password, and
  the rendered ConfigMap contains no plaintext password.
- No more forced choice between broken Temporal and a leaked credential.
- The dev/sandbox default (inline `persistence.password`) is unchanged.
- Affected specs: `deployment`.
