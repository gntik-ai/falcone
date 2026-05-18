# Tasks — add-tenant-api-keys

- [ ] **T01** Confirm baseline green (`corepack pnpm validate:repo`, `lint`, `test:unit`).
- [ ] **T02** Add `apps/control-plane/openapi/families/iam.openapi.json` operations for
      `/v1/workspaces/{workspaceId}/api-keys` (list, create, get, patch, delete, usage).
- [ ] **T03** Migration `services/provisioning-orchestrator/src/migrations/NNN-api-keys.sql`
      creating `tenant_api_keys` + indexes per [[design.md]].
- [ ] **T04** Implement key mint/rotate/revoke actions in `services/provisioning-orchestrator/src/actions/api-key-*.mjs`,
      reusing `credential_rotation_state`.
- [ ] **T05** Add internal contracts `services/internal-contracts/src/api-key-request-v1.json`,
      `api-key-result-v1.json`, `api-key-lifecycle-event-v1.json`.
- [ ] **T06** Implement APISIX plugin `services/gateway-config/plugins/tenant-api-key.lua`
      (Redis cache, argon2id verify, header binding); wire into routes via
      `services/gateway-config/base/`.
- [ ] **T07** Emit `iam.api_key.{created,rotated,revoked,disabled,enabled,auth_unavailable}`
      to Kafka per [[identity-and-access]] event taxonomy.
- [ ] **T08** Build `apps/web-console/src/pages/ConsoleApiKeysPage.tsx` with list, mint
      (one-time-reveal modal), rotate (grace-period banner), revoke, usage chart.
- [ ] **T09** Wire `ConsoleApiKeysPage` under workspace navigation; route
      `/console/workspaces/:workspaceId/api-keys`.
- [ ] **T10** Add plan quotas `api_keys.publishable.max`, `api_keys.service_role.max`,
      `api_keys.request_rate.publishable_rps`, `api_keys.request_rate.service_role_rps`
      to [[plan-tenant-provisioning]] catalog.
- [ ] **T11** Contract tests: gateway resolves `apikey` header, sets correct
      `x-falcone-*` headers, rejects expired/disabled/revoked, emits audit events.
- [ ] **T12** Documentation page in workspace-docs-service explaining the key model,
      security trade-offs, and the rotation workflow.
- [ ] **T13** Run `openspec validate --strict` and re-run baseline validators.
