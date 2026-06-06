## 1. data_type and column_default validation

- [ ] 1.1 Implement a PostgreSQL `data_type` allowlist in `services/provisioning-orchestrator/src/appliers/postgres-applier.mjs` (base scalar types, constrained forms with length/precision, array suffixes)
- [ ] 1.2 Implement a `column_default` safe-default ruleset (numeric literals, single-quoted string literals, `true`/`false`/`null`, approved function calls: `now()`, `gen_random_uuid()`)
- [ ] 1.3 Insert `data_type` and `column_default` validation in `_processResource:70-124` before any `_createResource` call
- [ ] 1.4 Accumulate validation errors and return them all before executing any DDL (consistent with error-accumulation loop in `apply:51-63`)

## 2. privilege_type validation

- [ ] 2.1 Implement a `privilege_type` allowlist: `SELECT`, `INSERT`, `UPDATE`, `DELETE`, `TRUNCATE`, `REFERENCES`, `TRIGGER`
- [ ] 2.2 Validate every GRANT `privilege_type` in `_processResource` before `_createResource` is called; return validation error on any unrecognized value

## 3. View definition hardening

- [ ] 3.1 Mark `item.definition` (view body) as trusted-only; add a validation check in `_processResource` that rejects any config where `item.definition` originates from tenant-controllable input
- [ ] 3.2 If view definitions are not supported from tenant configs, document the restriction and return a clear validation error

## 4. Verification

- [ ] 4.1 Add black-box test: reprovision with non-allowlist `data_type` returns validation error and executes no DDL
- [ ] 4.2 Add black-box test: reprovision with non-standard `privilege_type` returns validation error and executes no DDL
- [ ] 4.3 Add black-box test: reprovision with injection payload in `column_default` returns validation error
- [ ] 4.4 Add black-box test: reprovision with standard types and recognized privileges provisions successfully
- [ ] 4.5 Run `bash tests/blackbox/run.sh`
