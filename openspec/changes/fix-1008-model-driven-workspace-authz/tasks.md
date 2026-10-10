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

## Quota and CI Harness Follow-up

- [x] Verify the clean assigned branch at prior attempt HEAD
      c9911a6fc1dd0c73e123041286b3c9245f1b0dbd; preserve source gates and Hermes pins.
- [x] Reproduce all five checker-reported quota assertion failures before editing:
      node --import /tmp/falcone-1008-quota-boundaries.mjs --test
      --experimental-test-isolation=none
      tests/blackbox/live-resource-quota-enforcement.test.mjs
      tests/blackbox/storage-quota-handlers.test.mjs.
      Four topic cases returned 403 instead of 402/201; bucket admission returned
      403 instead of 409 STORAGE_QUOTA_EXCEEDED. Public seams are KAFKA_HANDLERS
      and STORAGE_HANDLERS responses. The shared workspace-admin fixture lacked
      workspaceIds; the bucket fixture lacked verified tenant_owner roles.
- [x] Add the explicit plural binding to the shared workspace-admin quota fixture;
      its eight topic/Mongo tests pass. Then add the verified tenant_owner role to
      the bucket fixture; its four quota/ownership/usage tests pass. Keep every
      existing quota assertion and production authorization decision unchanged.
- [x] Run every explicit blackbox test in ci.yml. The denial-audit harness also
      reproduced a real failure: its eleven-request matrix returned 500 on workspace
      GET instead of 403. Repeat with --test-name-pattern='eleven-request' on
      tests/blackbox/authorization-denial-audit.test.mjs, then supply the real can
      import when evaluating the extracted handler. All twelve audit tests pass.
- [x] Run the five executable CI quota suites plus denial-audit: 59/59 pass.
      Suites: live-resource-quota-enforcement, live-storage-function-quotas,
      workspace-quota-enforcement, storage-quota-enforcement,
      storage-quota-handlers, authorization-denial-audit.
      Use the import hook above: cached real YAML, with unused Kafka/Mongo/PG/CEL
      exports that throw if called; existing test fixtures inject backend I/O.
      Run in one process because subprocess-isolated hook runs do not complete
      correctly in this sandbox. No timeout wrapper was used.
- [x] Run mongo-gateway-route and postgres-gateway-route natively with
      FALCONE_CHART_PATH pointing at the assigned deployment chart: 11/11 pass,
      including Helm rendering and both immutable workflow pins.
- [x] Run scoped units with the hook: model-authz, workspace-model-authz,
      executor-workspace-binding, api-keys-scope-ceiling, workspace-list-tenant-scope,
      kafka-handlers-workspace-routes, kafka-handlers-metadata-recovery,
      storage-handlers-xml-parsing: 497/497 pass.
- [x] Run pg-browse-tenant-scope, events-topic-tenant-scope,
      storage-bucket-tenant-scope, executor-apikey-scope-ceiling and
      postgres-ddl-table-isolation with the hook: 23/23 pass.
- [x] Authorization-model validator passes using cached real YAML. OpenSpec strict
      validation and git diff --check pass. Retain the route-local database lookup
      to avoid widening the shared resolver's out-of-scope authorization behavior.
- [ ] Native authorization-model and flow-write-role-gate units: SKIPPED, missing
      yaml; the cached-YAML hook gets as far as missing ajv. Native validator:
      SKIPPED, missing yaml. Existing dependency declarations need no changes.
- [ ] CI storage-object-io-completeness: SKIPPED, missing @temporalio/activity.
      CI structural-write-role-gates-executor: SKIPPED, listen EPERM on 127.0.0.1.
      These are environment limits, not code assertion failures. PR CI must run
      both suites and the native dependency-backed checks above.
- [ ] Live RUNTIME_REQUIRED matrix and control-plane image build remain release
      obligations: no isolated live fixture/database, network or container images
      are available here. No runtime artifact is claimed.
