# Tasks — fix-ferretdb-gateway-authentication

## Investigation
- [ ] Determine the exact identity model FerretDB expects: does it read from
  `postgresql-url`'s user, or from a separate credential store?
- [ ] Confirm whether `MONGO_USER=falcone` exists as a PostgreSQL role on DocumentDB
  with the appropriate privileges, and whether FerretDB maps it.

## Implementation
- [ ] Align FerretDB `postgresql-url` (chart value) with the `MONGO_USER`/`MONGO_PASSWORD`
  the control-plane uses, creating the PostgreSQL role if needed.
- [ ] Alternatively: update the control-plane env vars to match the FerretDB-mapped identity.
- [ ] Add a readiness probe to the FerretDB gateway deployment that issues a `ping` command
  and fails if the handshake does not complete.
- [ ] Verify `POST /v1/workspaces/{w}/databases {engine:mongodb}` → 2xx (B.2 folded).

## Testing
- [ ] Write a real-stack test in `tests/env` for insert+list document round-trip via FerretDB.
- [ ] Run `bash tests/blackbox/run.sh` — `GET /v1/mongo/databases` → 200.
- [ ] Run `/opsx:verify fix-ferretdb-gateway-authentication`.

## Archive
- [ ] `/opsx:archive fix-ferretdb-gateway-authentication`
