# Tasks — fix-ferretdb-gateway-authentication

## Investigation
- [x] Identity model (authoritative: archived add-ferretdb-gateway design D7): FerretDB v2
  DELEGATES auth to its DocumentDB Postgres backend — a Mongo client must present credentials
  that map to a real Postgres login role. The gateway's own backend connection (postgresql-url)
  uses the DocumentDB admin/bootstrap role.
- [x] `MONGO_USER=falcone` is NOT a Postgres role on DocumentDB: the admin role is the
  `in-falcone-documentdb` POSTGRES_USER (e.g. `falcone_doc_admin` per make-secrets.sh / the
  FerretDB postgresql-url). The overlays hardcoded `MONGO_USER: falcone` → mismatch → handshake
  failed. Confirmed live (control-plane env: `MONGO_USER=falcone`) and against real FerretDB 2.7.0
  + DocumentDB (auth as `falcone` → "Authentication failed"; auth as the admin role → success).

## Implementation
- [x] Repoint `MONGO_USER` to the coherent identity: source it from the SAME secret as
  `MONGO_PASSWORD` (`in-falcone-documentdb` key `POSTGRES_USER`) so the Mongo client identity always
  equals the DocumentDB admin the FerretDB postgresql-url uses. Fixed in all four overlays:
  `deploy/kind/values-kind.yaml`, `deploy/kind/executor-demo.yaml`, `deploy/openshift/values-openshift.yaml`,
  `tests/live-campaign/values-campaign.yaml`.
- [x] Fail-closed readiness: the FerretDB gateway ALREADY ships a `/debug/readyz` readinessProbe that
  200s only once the DocumentDB backend connection is established (chart `ferretdb.readinessProbe`).
  Verified against real FerretDB 2.7.0: GOOD postgresql-url → readyz 200 (Ready); WRONG password →
  readyz 500 (NotReady, log "failed SASL auth: password authentication failed"). No new probe needed.
- [x] B.2 folded — the insert+list document round-trip succeeds once auth is coherent (proven below);
  `POST /v1/workspaces/{w}/databases {engine:mongodb}` provisions a document DB on the healthy path.

## Testing
- [x] Real-stack test `tests/env/ferretdb-gateway-auth.test.mjs`: admin identity authenticates + a
  full insert+list document round-trip succeeds; a non-existent identity is rejected. PASSES against
  the live tests/env FerretDB+DocumentDB (and self-skips when unreachable).
- [x] Black-box regression `tests/blackbox/ferretdb-gateway-mongo-user.test.mjs` (3 cases, helm-render):
  kind + openshift overlays + the executor-demo manifest source MONGO_USER from POSTGRES_USER, never a
  hardcoded `falcone`. `bash tests/blackbox/run.sh` → 658/658.
  (Note: GET /v1/mongo/databases → 200 over the full HTTP control-plane needs Keycloak/JWKS + a token;
  proven at the data layer via the FerretDB round-trip instead.)

## Archive
- [ ] `/opsx:archive fix-ferretdb-gateway-authentication`
