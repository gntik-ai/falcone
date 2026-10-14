# Tasks

- [x] Verify the clean assigned source worktree and issue branch.
- [x] Reproduce M7 own-tenant FORBIDDEN twice before editing source.
- [x] Add the failing regression at the runtime route-table / invokeRoute seam.
- [x] Use one owner-type set for the allow check and tenant equality check.
- [x] Cover mapped tenant admins, assigned and unassigned responses, M8 own and
  cross-tenant reads, denied types, legacy spelling, superadmin, missing actor
  id, missing tenant and actor tenant fallback.
- [x] Correct the two runtime notes without changing dispatch or auth metadata.
- [x] Survey the two other hyphen-only handlers and record separate follow-ups.
- [x] Complete bounded repository verification and prepare one local commit.
- [ ] CI: execute PostgreSQL plan-isolation coverage with DATABASE_URL configured.
- [ ] Independent R3 checker: both providers and human approval before delivery.
- [ ] RUNTIME_REQUIRED checker after normal release: real tenant_owner token
  returns 200 on M7; cross-tenant M8 returns 403.

## Source identity and seam

Initial source base: `445bef4086a1b98e3b1f0f54ae1d2f41d0f04128`.
Assigned branch: `agent/falcone/1154/6012b607-b1d6-5cff-be92-ff16aedd516b`.
Worktree: `/srv/engineering/worktrees/falcone/6012b607-b1d6-5cff-be92-ff16aedd516b`.
The path, git worktree identity and branch match the supplied assignment; the
initial worktree was clean.

The public seam loads and compiles `apps/control-plane/route-map.runtime.json`,
matches actual M7/M8 URLs, resolves the matched `/repo` handler path to this
repository and calls real `invokeRoute`. Verified identity fixtures use the
server's callerContext shape; a roles-only `[tenant_admin]` fixture has the
specified derived actor type `tenant_owner`. This tests dispatch and handler
authorization, not live token verification or server role derivation. Only the
external database is synthetic. Denials assert both error code and statusCode
and an empty query log; successful reads assert response tenant and bound
query tenant independently from fixture literals. ADR-2's verified-credential
tenant boundary is preserved.

## Red-to-green evidence

`node --test tests/unit/plan-assignment-get-route.test.mjs` failed before source
changes. Because the test subprocess output exposed only a file-level failure,
`node tests/unit/plan-assignment-get-route.test.mjs` was run twice to inspect the
exact symptom: FORBIDDEN from `authorize()` on an own-tenant M7 request, rather
than the required 200. The minimal fixture has one identity, one route and an
empty database response; no authentication service or running server is needed.

Diagnostic alternatives were an owner-spelling mismatch (predicts denial at
the allow check), lost identity forwarding (predicts missing actor id), and
missing tenant scope (predicts VALIDATION_ERROR). The reproduction's stack
identified the allow check; source inspection confirmed its hyphen-only
comparison. The bounded owner-set correction made the original reproduction
pass. The final expanded route suite has 35 passing behavioral checks,
including zero-query cross-tenant and denied-type cases.

The existing PostgreSQL isolation suite loads but skips its database scenario
because DATABASE_URL is not set. Legacy owner behavior is additionally tested
at the runtime seam with the synthetic database. Runtime release revalidation
belongs to the independent checker.

## Bounded verification and environment limits

- PASS: `node --test tests/unit/plan-assignment-get-route.test.mjs`; direct
  execution additionally exposes all 35 passing behavioral checks.
- PASS: `node --test tests/blackbox/tenant-create-plan-besteffort.test.mjs`;
  direct execution exposes 15 passing checks.
- PASS: `node --test tests/unit/route-catalog-reconciliation.test.mjs`.
- PASS: JSON parsing and comparison to the immutable base establish that only
  the M7/M8 notes changed; all other runtime route data is identical.
- SKIPPED: `node --test
  tests/integration/097-plan-entity-tenant-assignment/plan-isolation.test.mjs`:
  its database scenario skips because DATABASE_URL is not set.
- SKIPPED: complete `pnpm test:unit` verdict in this sandbox. The runner
  completed 238 files: 223 passed, while 15 could not run successfully here.
  Direct diagnostic execution confirmed socket listen EPERM on 127.0.0.1 or
  0.0.0.0, spawnSync git/node EPERM, and missing sibling deployment chart files
  under `../falcone-charts/charts/in-falcone/` (ENOENT). The topology assertions
  report the missing values file rather than an authorization regression.
  No code assertion failure independent of those environment limits was found.
  CI must rerun the full configured suite with sockets, subprocesses and its
  paired charts checkout available.

No timeout wrapper, dependency changes, debug instrumentation or repository
helper shim was introduced. The OpenSpec folder is explicitly staged despite
the repository's blanket openspec ignore rule, as required by this ChangeSet.
