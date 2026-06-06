## 1. Restore-initiate tenant binding

- [ ] 1.1 In `services/backup-status/src/api/initiate-restore.action.ts::main:19-75`, after scope validation add an assertion `body.tenant_id === token.tenantId`; return HTTP 403 on mismatch unless caller holds `superadmin` scope
- [ ] 1.2 Treat `token.tenantId` as the authoritative identity; treat `body.tenant_id` as untrusted input to be validated against it

## 2. Restore-confirm tenant binding

- [ ] 2.1 In `services/backup-status/src/api/confirm-restore.action.ts::main:20-23`, add the same `body.tenant_id === token.tenantId` assertion before any confirmation logic; return HTTP 403 on mismatch
- [ ] 2.2 Update the `ConfirmationsService.getStatus` call to pass `actor.tenantId` for scoping

## 3. ConfirmationsService.getStatus tenant assertion

- [ ] 3.1 In `services/backup-status/src/confirmations/confirmations.service.ts::ConfirmationsService.getStatus:500-514`, add `actor.tenantId === request.tenantId` assertion (or platform privilege check); return HTTP 403 on mismatch

## 4. resolveTenantName hardening

- [ ] 4.1 In `services/backup-status/src/confirmations/confirmations.service.ts::resolveTenantName:171-175`, remove the `return tenantId` echo default
- [ ] 4.2 Throw a configuration error when no resolver is wired, preventing the confirmation gate from being satisfied

## 5. Verification

- [ ] 5.1 Add black-box test `bbx-bkp-restore-cross-tenant-01`: tenant A cannot initiate a restore for tenant B (expect HTTP 403)
- [ ] 5.2 Add black-box test: tenant A cannot confirm a restore for tenant B (expect HTTP 403)
- [ ] 5.3 Add black-box test: `tenant_name_confirmation` equal to raw tenant id returns HTTP 422 when resolver is wired
- [ ] 5.4 Run `bash tests/blackbox/run.sh` and confirm green
