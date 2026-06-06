## 1. Extract tenantId in parseVaultEntry

- [ ] 1.1 In `services/secret-audit-handler/src/vault-log-reader.mjs::parseVaultEntry`, for entries where `domain === 'tenant'`, extract `tenantId = rest[0]` from the parsed Vault path and include it in the returned event object

## 2. Update SecretAuditEvent schema

- [ ] 2.1 Add a nullable `tenantId` field to `SecretAuditEvent` in `services/secret-audit-handler/src/event-schema.mjs:3-28`
- [ ] 2.2 Update `validateAuditEvent` to accept the new field without breaking validation of non-tenant-domain events where `tenantId` is null or absent

## 3. Implement per-tenant topic routing

- [ ] 3.1 Update `services/secret-audit-handler/src/kafka-publisher.mjs` to accept a dynamic topic parameter per event instead of a single static topic at construction time
- [ ] 3.2 In `services/secret-audit-handler/src/index.mjs`, remove the single static topic binding and compute the target topic at dispatch time: `console.secrets.audit.<tenantId>` for `domain === 'tenant'`, `console.secrets.audit.platform` for all other domains
- [ ] 3.3 Ensure the shared `console.secrets.audit` topic receives no events after the change

## 4. Consumer migration audit

- [ ] 4.1 Enumerate all existing consumers of `console.secrets.audit` and document required migration to per-tenant topics before deployment

## 5. Verification

- [ ] 5.1 Add black-box / integration test: publish a tenant-domain Vault audit event and assert it appears on `console.secrets.audit.<tenantId>` and NOT on any other tenant's topic or the shared topic
- [ ] 5.2 Add black-box / integration test: publish a platform-domain audit event and assert it appears on `console.secrets.audit.platform` only
- [ ] 5.3 Run `bash tests/blackbox/run.sh`
