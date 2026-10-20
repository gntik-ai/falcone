## Source implementation

- [x] Verify assigned clean worktree and issue branch.
- [x] Reproduce the realtime gap before changing source.
- [x] Add a shared verified workspace gate and predicate coverage.
- [x] Functions: gate workspace and action reads, deployment and definition export;
      retain mutation, platform-trust and dependency gates.
- [x] Data: gate PostgreSQL and MongoDB data/metadata before connections; preserve
      owner/admin checks and restrict MongoDB metadata counts to authorized workspaces.
- [x] Events: gate workspace and topic-ID routes, including SSE before consumer setup.
- [x] Webhooks/realtime/usage: gate workspace routes, including event-types; preserve
      tenant-addressed webhook validation/configuration precedence.
- [x] Refactor storage through the shared predicate; leave storage regression tests unchanged.
- [x] Add behavioral route coverage with frozen exclusions for existing out-of-scope routes.
- [x] Update authorized test fixtures with verified roles and workspaceIds.

## Validation and delivery

- [x] Complete scoped regression runs; unavailable full-suite prerequisites and final
      commit results are recorded in the maker output and follow-up handoff below.
- [x] Create the one local source commit required by the assigned execution contract.
- [ ] Independent checker review, R3 human approval and immutable-image replay
      (control plane; no deployment by the maker).

## Follow-up after independent checker

- [x] Reproduce stale secret-role fixtures before changes; update verified identities,
      retain bound-member 403 mutation checks, and test unbound/wrong-workspace 404
      reads and writes without vault access.
- [x] Restore the existing uniform Function workspace 403 contract and pin the
      absent/foreign/unbound envelopes before changing source.
- [x] Remove the newly added workspace_service_account Function read/invoke grants;
      update activation visibility coverage and document the singular claim break.
- [x] Reproduce MongoDB administrator metadata undercounting before the fix; retain
      tenant-wide legacy counts after registered workspace ownership is established.
- [x] Name shared family action sets, explain realtime/webhook mappings, reuse the
      MongoDB data resolver and remove the redundant storage provision check.
- [x] Run the 55 scoped unit suites and per-family blackbox regression coverage.
- [x] Validate the OpenSpec change and Markdown.
- [ ] PR CI must rerun full unit/blackbox/lint gates with normal subprocess/socket
      permissions, npm and the paired charts layout. This sandbox reports EPERM
      for local listeners and synchronous child processes; lint cannot find npm.
      The unchanged tenant-user-workspace-binding blackbox test also fails because
      createUser now includes emailVerified: false; no IAM source is changed here.

The original scoped-validation checkbox did not establish that the workspace-secret
regressions passed; those fixtures were missed in the first attempt. The follow-up
covers those unit contracts and updates the socket-based blackbox fixtures, whose
Vault fake cannot listen on 127.0.0.1 in this sandbox. CI remains authoritative for
the blackbox secret suite and other unavailable checks. The assigned follow-up
requires one additional local commit, without rewriting the existing family history.

## Second checker follow-up

- [x] Reproduce the image import failure with
      `node tests/blackbox/control-plane-image-imports.test.mjs`; the explicit COPY
      list omitted workspace-authz.mjs. Include the shared module in the image.
- [x] Reproduce both stale audit fixtures with
      `node tests/blackbox/audit-trail-integrity.test.mjs`; actorType-only ownership
      and an unbound member produced 404s. Add the verified owner role and bind the
      member so the additional 403 mutation role gate remains covered.
- [x] Reproduce request-store mismatches through topic listing, provisioning and
      quota admission with `node tests/unit/workspace-events-authz.test.mjs`, one
      failing scenario before each fix. Use ctx.store consistently for topic
      collection reads, insertion and quota metering after workspace resolution.
- [x] Pin exact Function denial status, code and message for every tested mutation.
- [x] Reuse the shared platform and verified administrator predicates in database
      metadata handlers; retain the additional structural gates and legacy counts.
- [x] Run 52 scoped suites: 50 pass (682 cases), including 80 route-coverage cases
      and unchanged storage authorization tests. Two HTTP-fixture suites cannot
      listen on 127.0.0.1 (EPERM): console-workspace-secrets and
      control-plane-mongo-list-query. Normal Node test process isolation also
      encounters subprocess EPERM; direct per-file runs execute the tests.
- [ ] PR CI must rerun the two socket-based suites, full lint and image build/scan.
      Immutable-image replay and R3 approvals remain control-plane delivery gates.

Tenant-addressed `/v1/webhooks/subscriptions/{subscriptionId}` routes remain in the
frozen exclusions, as the approved scope explicitly preserves their legacy behavior.
Their singular identity.workspaceId handling needs a separate scope decision. The
existing family commits are retained; this assigned correction is one additional
local commit, without rewriting history or touching deployment files/chart pins.
