## Implementation

- [x] Verify the clean assigned branch agent/falcone/1008/b2f1ef88-b73b-5d36-8712-7fdbe8e399c3
      at immutable source base 73570b190686a1c1764f1e04a75138591e8d0fb4.
- [x] Reproduce workspace GET failures before source changes (35 cases: 20 red).
      Sandbox command: node --loader /tmp/falcone-1008-kafka-loader.mjs --test
      --experimental-test-isolation=none tests/unit/workspace-model-authz.test.mjs.
      A repeated tenant_developer/own-tenant-bound case returned 403 instead of 200.
      Cause: canManageTenantId admits only tenant owner/admin and platform actors.
- [x] Add the model helper and fix workspace GET with accurate denial messages.
- [x] Watch tenant *.admin matrix assertions fail, then move only the six specified
      tenant grants. Test all seven roles across four actions and five contexts.
- [x] Watch bound workspace_admin database, bucket and topic tests fail separately;
      implement each route gate and observe its own matrix pass.
- [x] Reproduce absent-binding executor writes before changing the executor:
      workspace_admin/workspace_owner returned 201 instead of 403 for API-key issue
      on both verified-JWT and trusted-header paths. Command: node --test
      --experimental-test-isolation=none tests/unit/executor-workspace-binding.test.mjs
      (before the later GET invariant imported the local handler).
      Cause: the scope predicate returned false when workspaceIds was absent.
- [x] Narrowly deny absent workspace bindings and preserve broad-admin/API-key gates.
- [x] Cover key issue/revoke, provider PUT/DELETE, cross-tenant denials, missing/empty/
      different bindings, platform behavior and the write-implies-GET invariant.
- [x] Include the helper in the control-plane Dockerfile.
- [x] Run 399 new authorization tests and 77 scoped existing handler regressions.
      Tests run in one process because sandbox child-process isolation does not
      reliably complete. Temporary loader stubs throw if unavailable Kafka,
      MongoDB or PostgreSQL clients are used; test backend boundaries are injected.
      Update only the metadata-recovery owner fixture with its verified role;
      its original actorType-only fixture correctly became unauthorized.
- [x] Run 11 existing API-key scope-ceiling store/HTTP/MCP regressions using the
      real store and Node HTTP parser without socket listeners.
- [x] Validate the new OpenSpec change strictly and verify that the JSON diff
      contains exactly the six approved grant moves; source syntax/diff checks pass.
- [x] Run scripts/validate-authorization-model.mjs with an unused YAML-import stub
      that throws if parsing is attempted. The actual JSON validator passes.

## CI and Runtime Handoff

- [ ] Run native tests/unit/authorization-model.test.mjs and
      tests/unit/flow-write-role-gate.test.mjs with installed dependencies.
      Sandbox imports fail because yaml is absent; kafkajs, mongodb and pg are
      also absent. No dependency manifests or lockfiles need changes.
- [ ] Run the native authorization-model validator without the import stub.
      Sandbox native invocation cannot import yaml.
- [ ] Rerun existing executor regressions for #624/#773 over real sockets.
      Both attempted suites cannot listen on 127.0.0.1 (EPERM).
- [ ] Run the isolated live seven-role/five-route matrix plus key issue/revoke and
      provider PUT/DELETE with and without binding. Verify own/foreign tenants and
      different workspaces, preserve platform controls, and persist only redacted
      results by artifact ID/SHA256 (no tenant/workspace IDs, tokens or credentials).
      No configured isolated runtime/database exists in this sandbox; network and
      socket access are unavailable.
- [ ] Build the control-plane image and run normal PR CI/image/release gates.
      Docker/container and network checks belong to publication CI.
