# fix-kind-executor-realtime-url

## Change type
bugfix

## Capability
deployment

## Priority
P2

## Why
On the kind / live-campaign deployment the realtime change-stream API
(`GET /v1/realtime/workspaces/{ws}/data/{db}/collections/{c}/changes`) returns
**`501 REALTIME_DISABLED`** for an otherwise-valid, authenticated request. GitHub issue #621.

**Root cause (code-verified).** The realtime executor activates ONLY when `REALTIME_DOCUMENTDB_URL`
is set: `apps/control-plane/src/runtime/main.mjs:137` reads
`process.env.REALTIME_DOCUMENTDB_URL ?? process.env.DOCUMENTDB_REPLICATION_URL` and only then calls
`createRealtimeExecutor(...)` (`main.mjs:141`); when it is unset the executor is `undefined` and every
`/v1/realtime/*` request hits the guard at `apps/control-plane/src/runtime/server.mjs:665`
(`throw … { statusCode: 501, code: 'REALTIME_DISABLED' }`).

The manifest that `tests/live-campaign/install.sh` actually applies for the executor —
`deploy/kind/executor-demo.yaml` — sets `MONGO_HOST/MONGO_USER/MONGO_PASSWORD/KAFKA_BROKERS/…` but
**does NOT set `REALTIME_DOCUMENTDB_URL`**. The Helm `controlPlane.env` stanza in
`tests/live-campaign/values-campaign.yaml:118` *does* set it (from
`in-falcone-documentdb-replication.realtime-url`, `optional: true`), and the secret
`in-falcone-documentdb-replication` *does* contain the `realtime-url` key — but that stanza is not what
`install.sh` deploys, so the running executor never receives the value. The realtime capability is
therefore silently off on the primary kind dev/eval path despite all of its inputs being present: a
drift between two executor definitions (the Helm values vs the demo manifest).

Route auth and tenant isolation on `/v1/realtime/*` are unaffected (no key → 401; tenant A's key on
tenant B's channel → 403).

## What Changes
- `deploy/kind/executor-demo.yaml`: add `REALTIME_DOCUMENTDB_URL` to the `falcone-cp-executor`
  container env, sourced from `secretKeyRef` `in-falcone-documentdb-replication` key `realtime-url`
  with `optional: true` — identical wiring to the `controlPlane.env` stanza in
  `tests/live-campaign/values-campaign.yaml`. When the secret/key is absent the env is simply not
  injected (the executor still starts; realtime stays disabled), so non-realtime profiles are
  unaffected. The publication name keeps `main.mjs`'s `falcone_cdc_pub` default (both definitions
  agree), so `REALTIME_PUBLICATION` is intentionally not added.

## Impact
- On the kind stack, when `in-falcone-documentdb-replication.realtime-url` is present the executor
  runs with `REALTIME_DOCUMENTDB_URL` set and `/v1/realtime/*/changes` opens an SSE stream (200)
  instead of returning `501 REALTIME_DISABLED`.
- The two executor definitions (demo manifest + campaign Helm values) no longer drift on realtime
  wiring.
- No change to the realtime route contract, auth, or tenant scoping.
- Affected specs: `deployment`.
