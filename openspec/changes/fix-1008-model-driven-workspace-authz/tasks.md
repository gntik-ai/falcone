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

## Checker Follow-up

- [x] Verify the clean assigned branch at prior attempt HEAD
      60ae44442010a7e8a38be260fe26ead20a0fe146; preserve that work and Hermes pins.
- [x] Invert the stale tenant_admin database.admin denial assertion to match the
      approved grant. Search unit tests for database.admin/bucket.admin/topic.admin:
      no other old-denial assertion remains; the flow-role suite asserts no such grant.
- [x] Reproduce the singular trusted-header issue twice before changing source:
      node --test --experimental-test-isolation=none --test-name-pattern='explicit singular'
      tests/unit/executor-workspace-binding.test.mjs.
      API-key issue returned 403 instead of 201. The matching plural-binding control
      passed. Confirmed cause: the absent-array branch ignored credentialWorkspaceId.
      The public seam is real HTTP parsing through createControlPlaneServer.
- [x] Recognize matching singular credentials only in that absent-array branch.
      Preserve role checks, explicit plural restrictions, API-key denial precedence,
      tenant isolation and broad-admin behavior. Encode an empty plural header as
      comma-only CSV so HTTP whitespace trimming does not turn the fixture into an
      absent header. Document the trusted singular binding in the OpenSpec.
- [x] Run the executor cases with --test-name-pattern='executor': 114/114 pass,
      including 34 new singular-binding/role/isolation regressions.
      Run model-authz.test.mjs: 144/144 pass. API-key scope-ceiling: 8/8 pass.
- [x] Run the real authorization-model validator using a temporary resolution hook
      for cached YAML 2.9.1 from /opt/engineering-cli/node_modules (no parsing stub):
      node --import /tmp/falcone-1008-revision-yaml-hook.mjs
      scripts/validate-authorization-model.mjs. Internally consistent.
- [x] Retain the route-local database lookup: widening the shared management helper
      would affect out-of-scope routes and violate the implementation constraint.
- [x] OpenSpec strict validation, source/test syntax checks and git diff --check pass.
- [ ] Native authorization-model.test.mjs and flow-write-role-gate.test.mjs cannot
      import missing yaml. Retrying the contract with cached YAML then hits missing
      cel-js. Native validator likewise cannot import yaml. Leave these native checks
      to CI; dependency manifests and lockfiles do not need changes.
- [ ] Native workspace-model-authz and write-implies-GET invariant tests cannot
      import missing kafkajs. Existing handler regression imports also need database
      clients unavailable here. Leave dependency-backed handler checks to CI.
- [ ] Executor #624 regression cannot import missing pg; #773 structural regression
      cannot listen on 127.0.0.1 (EPERM). These are environment skips, not assertions.
- [ ] Live runtime matrix and image/release checks remain the handoff above: no
      isolated fixture/database or container/network access, and no runtime artifact.
