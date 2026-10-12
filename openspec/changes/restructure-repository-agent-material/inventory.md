# Tracked repository inventory

## Snapshot and reproduction

Assigned issue: #1099; request `f0ee7e5f-e3c6-48ee-9dd5-7db0b31c3ce3`, revision 2; risk R2.
Immutable input: `dead4806656a400a0d6db86a74e0f210c6aee6e9`; branch `agent/falcone/1099/6334d7a7-80ac-51f9-8076-050c34ed351c`.
The assigned worktree was clean before work. Its path and `git worktree list --porcelain`
agree on the lease identifier `6334d7a7-80ac-51f9-8076-050c34ed351c`.
There is no `origin/main` ref in this offline checkout; use the immutable input above
for the local scope check, and `origin/main...HEAD` in PR CI.

Run from the source root with `LC_ALL=C` on the phase-1 head, after force-adding
this directory. The following commands produce the three stored output sections
below; compare them byte-for-byte, with LF line endings:

```sh
export LC_ALL=C
git ls-files | cut -d/ -f1 | sort -u
git ls-files | cut -d/ -f1-2 | sort -u
git ls-files
git ls-files openspec | wc -l
git ls-files .idea
```

Baseline: 3163 files. Phase 1: 3164 files. Baseline OpenSpec: 115
files across 35 changes;
phase-1 `git ls-files openspec | wc -l` returns **119 > 0**. This proves OpenSpec is
tracked despite `.gitignore:50` (`/openspec/`), which remains byte-identical.
`git ls-files .idea` returns empty after phase 1.

The only path-set delta from the input is these four removals and five additions;
README and .gitignore change content but keep their paths:

| Operation | Path |
| --- | --- |
| D | `.idea/.gitignore` |
| D | `.idea/atelier.iml` |
| D | `.idea/modules.xml` |
| D | `.idea/vcs.xml` |
| A | `CONTRIBUTING.md` |
| A | `openspec/changes/restructure-repository-agent-material/design.md` |
| A | `openspec/changes/restructure-repository-agent-material/inventory.md` |
| A | `openspec/changes/restructure-repository-agent-material/proposal.md` |
| A | `openspec/changes/restructure-repository-agent-material/tasks.md` |

## Reader discovery and credential handling

Readers are discovered exclusively with `git grep` over tracked files, including
ignored-but-tracked OpenSpec. Do not substitute filesystem globbing or ripgrep.
Use the immutable input for reader citations so new inventory prose does not
become circular evidence. Commands used:

```sh
git grep -n -I -F -e '<entry path>' dead4806656a400a0d6db86a74e0f210c6aee6e9 --
git grep -n -I -e 'spikes/' -e 'falcone-loop-state' -e 'delivery-adapter' -e 'track-f' dead4806656a400a0d6db86a74e0f210c6aee6e9 --
git ls-files | python3 -c 'import re,sys; print("".join(p for p in sys.stdin if re.search(r"(^|/)(AGENTS[.]md|CLAUDE[.]md|[.]claude|[.]codex|[.]idea|prompts|evidence)(/|$)|loop-state|SKILL[.]md",p)),end="")'
```

The first command is repeated for every top/second-level entry below. Citations
are literal-reference evidence, not proof of execution or external Hermes reads.
`no reader found` means no literal reference to that entry in this tracked input.
No raw grep source lines are stored: before persistence, discard source text and
retain only filename, line number and matched path category. Inspect those fields
for secret-like strings; never store token values, auth headers, kubeconfigs or
OAuth material. The snapshot-derived fields stored here contain only repository
paths and numeric line locations. The keyword supplement found no tracked
AGENTS.md, CLAUDE.md, .claude/, .codex/ or SKILL.md, and no additional matches outside
the non-product rules below. Ignored local tooling is outside the tracked inventory.

## Top-level classification (summary, not matching rules)

`docs/` is product documentation except `docs/track-f/**`, classified as process.
`internal-contracts/` consists entirely of the three process schema baselines under
`secrets/`; these are schema definitions, not stored secret values. Retain them.
`logo-original.png` is provisionally obsolete (no reader found), pending asset-owner
confirmation; retain it. `logo.svg` is product: README.md:2 reads the root asset;
docs-site/.vitepress/config.mts:23 names a site logo but does not prove a root-file reader.

| Entry | Class | Phase-1 files | Reader evidence at input |
| --- | --- | --- | --- |
| `.dockerignore` | product | 1 | no reader found |
| `.env.example` | product | 1 | `.gitignore:8`, `delivery-adapter/GAP-001/FILE-SHA256SUMS:11`, `delivery-adapter/GAP-001/FILE-SHA256SUMS:23`, `delivery-adapter/GAP-001/FILE-SHA256SUMS:32` |
| `.github` | product | 4 | `.github/workflows/deploy-docs.yml:8`, `apps/web-console/Dockerfile:4`, `delivery-adapter/GAP-001/FILE-SHA256SUMS:69`, `delivery-adapter/GAP-001/hermes-workflows-suite/adapters/common/lib.sh:187` |
| `.gitignore` | product | 1 | `docs/track-f/falcone-track-getting-started.md:38`, `falcone-loop-state/RUNLOG.md:331`, `spikes/add-flows-adr-temporal-spikes/.gitignore:2` |
| `.markdownlint-cli2.jsonc` | product | 1 | `scripts/validate-structure.mjs:11` |
| `CONTRIBUTING.md` | product | 1 | no reader found |
| `LICENSE` | product | 1 | `README.de.md:294`, `README.de.md:306`, `README.de.md:373`, `README.es.md:291` |
| `README.de.md` | product | 1 | `README.es.md:21`, `README.fr.md:21`, `README.md:21`, `README.ru.md:21` |
| `README.es.md` | product | 1 | `README.de.md:19`, `README.fr.md:19`, `README.md:19`, `README.ru.md:19` |
| `README.fr.md` | product | 1 | `README.de.md:20`, `README.es.md:20`, `README.md:20`, `README.ru.md:20` |
| `README.md` | product | 1 | `README.de.md:18`, `README.es.md:18`, `README.fr.md:18`, `README.ru.md:18` |
| `README.ru.md` | product | 1 | `README.de.md:23`, `README.es.md:23`, `README.fr.md:23`, `README.md:23` |
| `README.zh.md` | product | 1 | `README.de.md:22`, `README.es.md:22`, `README.fr.md:22`, `README.md:22` |
| `apps` | product | 754 | `.dockerignore:20`, `.dockerignore:25`, `.dockerignore:26`, `.github/workflows/ci.yml:219` |
| `delivery-adapter` | process | 13 | `delivery-adapter/GAP-001/README.md:3`, `delivery-adapter/GAP-001/test-fixtures/falcone/staging-backup-evidence-contract.json:6`, `scripts/operations/staging-backup-evidence-contract.json:6` |
| `deploy` | product | 55 | `.dockerignore:13`, `.dockerignore:14`, `.dockerignore:15`, `.dockerignore:16` |
| `docs` | product; track-f process | 80 | `.github/workflows/deploy-docs.yml:7`, `.github/workflows/deploy-docs.yml:8`, `.github/workflows/deploy-docs.yml:41`, `.github/workflows/deploy-docs.yml:50` |
| `docs-site` | product | 77 | `.github/workflows/deploy-docs.yml:7`, `.github/workflows/deploy-docs.yml:41`, `.github/workflows/deploy-docs.yml:50`, `README.de.md:159` |
| `falcone-loop-state` | agent-memory | 5 | `docs/track-f/falcone-track-getting-started.md:34`, `docs/track-f/prompts/f0-verification.md:16`, `docs/track-f/triage.md:332`, `docs/track-f/triage.md:334` |
| `internal-contracts` | process | 3 | `.github/workflows/ci.yml:226`, `.github/workflows/ci.yml:233`, `README.de.md:282`, `README.es.md:279` |
| `logo-original.png` | obsolete | 1 | no reader found |
| `logo.svg` | product | 1 | `README.de.md:2`, `README.es.md:2`, `README.fr.md:2`, `README.md:2` |
| `openspec` | agent-memory | 119 | `.gitignore:50`, `deploy/kind/README.md:101`, `docs-site/operations/webhook-signing-key-lifecycle.md:2848`, `docs/reference/architecture/console-design-system-primitives.md:96` |
| `package.json` | product | 1 | `apps/control-plane-executor/Dockerfile:21`, `apps/control-plane-executor/Dockerfile:45`, `apps/control-plane/Dockerfile:20`, `apps/web-console/src/styles/brand-tokens.test.ts:169` |
| `packages` | product | 755 | `.github/workflows/ci.yml:226`, `.github/workflows/ci.yml:233`, `.github/workflows/release-images.yml:44`, `README.de.md:280` |
| `pnpm-lock.yaml` | product | 1 | `tests/blackbox/source-build-root-context.test.mjs:111` |
| `pnpm-workspace.yaml` | product | 1 | `scripts/validate-structure.mjs:8` |
| `scripts` | product | 75 | `apps/control-plane-executor/Dockerfile:39`, `apps/control-plane-executor/package.json:7`, `apps/control-plane-executor/src/mcp-registry.mjs:14`, `apps/control-plane-executor/src/mcp-registry.mjs:183` |
| `service-catalog.json` | product | 1 | `README.de.md:285`, `README.es.md:282`, `README.fr.md:286`, `README.md:285` |
| `spikes` | process | 66 | `docs-site/architecture/adrs.md:98`, `docs-site/architecture/adrs.md:116`, `packages/adapters/src/seaweedfs-iam-client.mjs:8`, `packages/provisioning-orchestrator/src/config/seaweedfs-compat-matrix.json:2` |
| `tests` | product | 1102 | `.dockerignore:12`, `.github/workflows/ci.yml:53`, `.github/workflows/ci.yml:58`, `.github/workflows/ci.yml:59` |
| `tools` | product | 37 | `.github/workflows/release-images.yml:202`, `.github/workflows/release-images.yml:269`, `.github/workflows/release-images.yml:270`, `README.de.md:283` |
| `turbo.json` | product | 1 | `scripts/validate-structure.mjs:9` |

Removed baseline entry: `.idea/**` => obsolete, **4** files, no reader found.
It contains `.gitignore`, `atelier.iml`, `modules.xml`, `vcs.xml`; all four are deleted.

## Disjoint recursive classification rules

These are the operative rules. A literal file matches only itself; `dir/**` matches
every tracked descendant at any depth. Each phase-1 path must match exactly one
row, and each count must match. No ancestor summary is an additional rule. Thus
nested evidence, prompts, spike package/lock files and snapshot scripts are fully
covered without a keyword heuristic. Rule citations apply recursively to the group;
they do not imply every individual descendant is read. Unreferenced groups say
`no reader found`. Product classifications identify source, runtime assets,
deployment/test infrastructure, docs, and build tooling; process classifications
identify experiments, plans and retained external-adapter evidence.

| Exact path or recursive rule | Class | Phase-1 files | Reader evidence at input |
| --- | --- | --- | --- |
| `.dockerignore` | product | 1 | no reader found |
| `.env.example` | product | 1 | `.gitignore:8`, `delivery-adapter/GAP-001/FILE-SHA256SUMS:11`, `delivery-adapter/GAP-001/FILE-SHA256SUMS:23`, `delivery-adapter/GAP-001/FILE-SHA256SUMS:32` |
| `.github/workflows/**` | product | 4 | `.github/workflows/deploy-docs.yml:8`, `apps/web-console/Dockerfile:4`, `delivery-adapter/GAP-001/FILE-SHA256SUMS:69`, `docs-site/contributing/index.md:65` |
| `.gitignore` | product | 1 | `docs/track-f/falcone-track-getting-started.md:38`, `falcone-loop-state/RUNLOG.md:331`, `spikes/add-flows-adr-temporal-spikes/.gitignore:2` |
| `.markdownlint-cli2.jsonc` | product | 1 | `scripts/validate-structure.mjs:11` |
| `CONTRIBUTING.md` | product | 1 | no reader found |
| `LICENSE` | product | 1 | `README.de.md:294`, `README.de.md:306`, `README.de.md:373`, `README.es.md:291` |
| `README.de.md` | product | 1 | `README.es.md:21`, `README.fr.md:21`, `README.md:21`, `README.ru.md:21` |
| `README.es.md` | product | 1 | `README.de.md:19`, `README.fr.md:19`, `README.md:19`, `README.ru.md:19` |
| `README.fr.md` | product | 1 | `README.de.md:20`, `README.es.md:20`, `README.md:20`, `README.ru.md:20` |
| `README.md` | product | 1 | `README.de.md:18`, `README.es.md:18`, `README.fr.md:18`, `README.ru.md:18` |
| `README.ru.md` | product | 1 | `README.de.md:23`, `README.es.md:23`, `README.fr.md:23`, `README.md:23` |
| `README.zh.md` | product | 1 | `README.de.md:22`, `README.es.md:22`, `README.fr.md:22`, `README.md:22` |
| `apps/console/**` | product | 8 | `openspec/changes/restructure-service-code-layout/design.md:22`, `scripts/lib/service-catalog.mjs:412`, `scripts/lib/service-catalog.mjs:413`, `service-catalog.json:222` |
| `apps/control-plane/**` | product | 67 | `.github/workflows/ci.yml:219`, `.github/workflows/integration.yml:72`, `.github/workflows/integration.yml:73`, `.github/workflows/release-images.yml:13` |
| `apps/control-plane-executor/**` | product | 132 | `.github/workflows/ci.yml:219`, `.github/workflows/integration.yml:73`, `.github/workflows/release-images.yml:15`, `.github/workflows/release-images.yml:65` |
| `apps/fn-runtime/**` | product | 3 | `.github/workflows/release-images.yml:19`, `.github/workflows/release-images.yml:70`, `apps/fn-runtime/Dockerfile:12`, `deploy/OPENSHIFT-HARBOR-REVIEW.md:139` |
| `apps/mcp-runtime/**` | product | 2 | `.github/workflows/integration.yml:71`, `.github/workflows/release-images.yml:21`, `.github/workflows/release-images.yml:74`, `apps/mcp-runtime/Dockerfile:2` |
| `apps/web-console/**` | product | 511 | `.dockerignore:20`, `.dockerignore:25`, `.dockerignore:26`, `.github/workflows/integration.yml:75` |
| `apps/workflow-worker/**` | product | 31 | `.github/workflows/integration.yml:74`, `.github/workflows/release-images.yml:20`, `.github/workflows/release-images.yml:72`, `apps/control-plane-executor/Dockerfile:27` |
| `delivery-adapter/GAP-001/**` | process | 13 | no reader found |
| `deploy/OPENSHIFT-HARBOR-REVIEW.md` | product | 1 | `docs-site/operations/openshift-install.md:11`, `tests/blackbox/legacy-components-absent.test.mjs:124` |
| `deploy/apisix/**` | product | 2 | `tests/blackbox/legacy-components-absent.test.mjs:122`, `tests/blackbox/legacy-components-absent.test.mjs:123` |
| `deploy/gateway-config/**` | product | 23 | `apps/control-plane-executor/src/runtime/auth-roles.mjs:14`, `apps/control-plane/b-handlers.mjs:1562`, `deploy/gateway-config/routes/mcp-routes.yaml:11`, `deploy/gateway-config/tests/plugins/scope-enforcement-domain_spec.lua:12` |
| `deploy/k8s/**` | product | 1 | no reader found |
| `deploy/keycloak-config/**` | product | 4 | `openspec/changes/restructure-service-code-layout/design.md:19`, `scripts/lib/service-catalog.mjs:382`, `service-catalog.json:208` |
| `deploy/kind/**` | product | 24 | `.dockerignore:13`, `.dockerignore:14`, `.dockerignore:15`, `.dockerignore:16` |
| `docs-site/.vitepress/**` | product | 1 | `.github/workflows/deploy-docs.yml:50` |
| `docs-site/api/**` | product | 5 | `docs/reference/architecture/gateway-authentication-and-passthrough.md:101`, `tests/blackbox/legacy-components-absent.test.mjs:132`, `tests/blackbox/legacy-components-absent.test.mjs:133` |
| `docs-site/architecture/**` | product | 13 | `README.de.md:159`, `README.de.md:161`, `README.de.md:164`, `README.de.md:167` |
| `docs-site/contributing/**` | product | 1 | no reader found |
| `docs-site/guide/**` | product | 9 | `README.md:194`, `README.md:271`, `docs/reference/architecture/knative-runtime-status.md:23`, `falcone-loop-state/FINDINGS.md:902` |
| `docs-site/index.md` | product | 1 | no reader found |
| `docs-site/operations/**` | product | 9 | `openspec/changes/add-929-openshift-private-base-images/proposal.md:32`, `openspec/changes/add-929-openshift-private-base-images/proposal.md:37`, `openspec/changes/add-929-openshift-private-base-images/specs/deployment-packaging/spec.md:38`, `openspec/changes/add-929-openshift-private-base-images/specs/deployment-packaging/spec.md:43` |
| `docs-site/package.json` | product | 1 | no reader found |
| `docs-site/personas/**` | product | 3 | `falcone-loop-state/FINDINGS.md:899`, `tests/blackbox/all-core-install-readiness.test.mjs:819` |
| `docs-site/public/**` | product | 34 | no reader found |
| `docs/installation/**` | product | 4 | `README.md:191`, `falcone-loop-state/FINDINGS.md:85`, `openspec/changes/fix-972-function-sandbox-isolation/design.md:53`, `tests/blackbox/all-core-install-readiness.test.mjs:803` |
| `docs/reference/**` | product | 65 | `apps/web-console/src/lib/structural-write-access.ts:5`, `apps/web-console/src/pages/ConsoleTenantPlanOverviewPage.tsx:60`, `deploy/kind/README.md:90`, `docs-site/architecture/adrs.md:11` |
| `docs/track-f/**` | process | 11 | `docs/track-f/falcone-track-getting-started.md:36`, `docs/track-f/falcone-track-getting-started.md:45`, `docs/track-f/falcone-track-getting-started.md:46`, `docs/track-f/falcone-track-getting-started.md:99` |
| `falcone-loop-state/CAPABILITIES.md` | agent-memory | 1 | `docs/track-f/triage.md:334` |
| `falcone-loop-state/COVERAGE.md` | agent-memory | 1 | `docs/track-f/triage.md:332` |
| `falcone-loop-state/FINDINGS.md` | agent-memory | 1 | no reader found |
| `falcone-loop-state/RUNLOG.md` | agent-memory | 1 | no reader found |
| `falcone-loop-state/TEST-PLAN.md` | agent-memory | 1 | `docs/track-f/prompts/f0-verification.md:16` |
| `internal-contracts/secrets/**` | process | 3 | no reader found |
| `logo-original.png` | obsolete | 1 | no reader found |
| `logo.svg` | product | 1 | `README.de.md:2`, `README.es.md:2`, `README.fr.md:2`, `README.md:2` |
| `openspec/changes/**` | agent-memory | 119 | `deploy/kind/README.md:101`, `docs-site/operations/webhook-signing-key-lifecycle.md:2848`, `docs/reference/architecture/console-design-system-primitives.md:96`, `docs/reference/architecture/knative-runtime-status.md:38` |
| `package.json` | product | 1 | `apps/control-plane-executor/Dockerfile:21`, `apps/control-plane-executor/Dockerfile:45`, `apps/control-plane/Dockerfile:20`, `apps/web-console/src/styles/brand-tokens.test.ts:169` |
| `packages/adapters/**` | product | 29 | `apps/control-plane-executor/Dockerfile:3`, `apps/control-plane-executor/Dockerfile:40`, `apps/control-plane-executor/src/console-backend-functions.mjs:6`, `apps/control-plane-executor/src/events-admin.mjs:13` |
| `packages/audit/**` | product | 4 | `apps/control-plane-executor/Dockerfile:28`, `apps/control-plane-executor/Dockerfile:48`, `apps/control-plane-executor/src/runtime/flow-audit-relay.test.mjs:3`, `apps/control-plane-executor/src/runtime/flow-executor.mjs:48` |
| `packages/audit-anomaly-handler/**` | product | 5 | `pnpm-lock.yaml:261`, `tests/blackbox/audit-anomaly-alerting.test.mjs:27`, `tests/blackbox/audit-anomaly-alerting.test.mjs:28`, `tests/blackbox/audit-anomaly-alerting.test.mjs:29` |
| `packages/backup-status/**` | product | 116 | `apps/console/src/components/backup/AuditEventDetail.tsx:2`, `apps/console/src/components/backup/AuditEventFilters.tsx:2`, `apps/console/src/components/backup/AuditEventTable.tsx:4`, `apps/console/src/components/backup/AuditEventTypeBadge.tsx:2` |
| `packages/billing-export/**` | product | 5 | `pnpm-lock.yaml:292`, `tests/blackbox/usage-billing-export.test.mjs:34`, `tests/blackbox/usage-billing-export.test.mjs:35` |
| `packages/event-gateway/**` | product | 4 | `apps/control-plane-executor/src/events-admin.mjs:22`, `apps/control-plane-executor/src/events-admin.mjs:31`, `apps/control-plane/Dockerfile:76`, `packages/internal-contracts/src/internal-service-map.json:203` |
| `packages/internal-contracts/**` | product | 79 | `.github/workflows/ci.yml:226`, `.github/workflows/ci.yml:233`, `apps/control-plane-executor/Dockerfile:16`, `apps/control-plane-executor/Dockerfile:41` |
| `packages/mcp-server-sdk/**` | product | 8 | `falcone-loop-state/TEST-PLAN.md:65`, `pnpm-lock.yaml:309` |
| `packages/mongo-cdc-bridge/**` | product | 22 | `apps/control-plane-executor/Dockerfile:46`, `apps/control-plane-executor/src/runtime/realtime-executor.mjs:16`, `apps/control-plane-executor/src/runtime/realtime-executor.mjs:17`, `apps/control-plane-executor/src/runtime/realtime-executor.mjs:18` |
| `packages/openapi-sdk-service/**` | product | 33 | `docs-site/architecture/adrs.md:126`, `pnpm-lock.yaml:329`, `spikes/add-seaweedfs-storage-adr-spike/compatibility-matrix.md:16`, `tests/blackbox/openapi-sdk-cross-tenant.test.mjs:16` |
| `packages/pg-cdc-bridge/**` | product | 15 | `packages/pg-cdc-bridge/tests/integration/cdc-topic-isolation.kafka.test.mjs:6`, `pnpm-lock.yaml:351`, `service-catalog.json:174`, `tests/blackbox/cdc-overflow-dead-letter.test.mjs:28` |
| `packages/provisioning-orchestrator/**` | product | 354 | `apps/control-plane-executor/src/runtime/flow-quota-gate.mjs:11`, `apps/control-plane-executor/src/runtime/flow-trigger-registry.mjs:743`, `apps/control-plane-executor/src/workflows/wf-con-004-credential-generation.mjs:2`, `apps/control-plane-executor/src/workflows/wf-con-004-credential-generation.mjs:3` |
| `packages/realtime-gateway/**` | product | 18 | `apps/workflow-worker/README.md:10`, `docs-site/architecture/services.md:91`, `packages/backup-status/src/api/backup-status.auth.ts:5`, `pnpm-lock.yaml:372` |
| `packages/scheduling-engine/**` | product | 13 | `apps/control-plane-executor/src/runtime/flow-trigger-registry.mjs:24`, `apps/control-plane/Dockerfile:77`, `apps/control-plane/Dockerfile:100`, `apps/control-plane/required-migrations.txt:74` |
| `packages/secret-audit-handler/**` | product | 12 | `docs-site/operations/openshift-airgapped-harbor.md:3107`, `docs/installation/openshift-airgapped-harbor.md:3107`, `docs/reference/architecture/workspace-secrets-console.md:180`, `packages/audit-anomaly-handler/src/alert-publisher.mjs:5` |
| `packages/webhook-engine/**` | product | 20 | `apps/control-plane-executor/Dockerfile:16`, `apps/control-plane-executor/Dockerfile:29`, `apps/control-plane-executor/Dockerfile:49`, `apps/control-plane-executor/src/runtime/byok-provider-guard.mjs:21` |
| `packages/workspace-docs-service/**` | product | 18 | `apps/control-plane-executor/Dockerfile:30`, `apps/control-plane-executor/Dockerfile:50`, `apps/control-plane-executor/Dockerfile:51`, `apps/control-plane-executor/src/runtime/server.mjs:24` |
| `pnpm-lock.yaml` | product | 1 | `tests/blackbox/source-build-root-context.test.mjs:111` |
| `pnpm-workspace.yaml` | product | 1 | `scripts/validate-structure.mjs:8` |
| `scripts/backfill-ferretdb-tenant-identities.mjs` | product | 1 | no reader found |
| `scripts/backfill-seaweedfs-identities.mjs` | product | 1 | `tests/unit/backfill-seaweedfs-identities.test.mjs:4` |
| `scripts/backfill-tenant-realm-audience.mjs` | product | 1 | `apps/control-plane-executor/Dockerfile:39`, `apps/control-plane/Dockerfile:91`, `deploy/kind/README.md:95`, `openspec/changes/fix-980-mongo-bearer-executor-route/proposal.md:21` |
| `scripts/backfill-tenant-realm-identity-claims.mjs` | product | 1 | `apps/control-plane/kc-admin.mjs:329`, `docs/reference/architecture/workspace-id-claim-rollout.md:107`, `docs/reference/architecture/workspace-id-claim-rollout.md:118`, `docs/reference/architecture/workspace-id-claim-rollout.md:119` |
| `scripts/check-control-plane-routes.mjs` | product | 1 | `apps/control-plane/Dockerfile:107` |
| `scripts/generate-public-api-artifacts.mjs` | product | 1 | `package.json:14` |
| `scripts/lib/**` | product | 28 | `apps/control-plane-executor/src/mcp-registry.mjs:14`, `apps/control-plane-executor/src/mcp-registry.mjs:183`, `docs-site/architecture/adrs.md:59`, `docs-site/architecture/services.md:21` |
| `scripts/lint-snippet-templates.mjs` | product | 1 | `package.json:31` |
| `scripts/lint-snippet-templates.test.mjs` | product | 1 | `package.json:45` |
| `scripts/operations/**` | product | 1 | `delivery-adapter/GAP-001/hermes-workflows-suite/adapters/falcone/adapter.env.example:29`, `delivery-adapter/GAP-001/hermes-workflows-suite/adapters/falcone/backup-evidence.sh:15`, `delivery-adapter/GAP-001/hermes-workflows-suite/adapters/falcone/validate-backup-evidence.sh:11`, `delivery-adapter/GAP-001/tests/test-falcone-backup-evidence.sh:86` |
| `scripts/realtime-snippet-templates.data.mjs` | product | 1 | no reader found |
| `scripts/system-changes/**` | product | 8 | `docs-site/operations/backup-restore.md:55`, `docs-site/operations/backup-restore.md:69`, `docs-site/operations/backup-restore.md:76`, `docs-site/operations/backup-restore.md:82` |
| `scripts/validate-authorization-model.mjs` | product | 1 | `openspec/changes/fix-1008-model-driven-workspace-authz/tasks.md:35`, `openspec/changes/fix-1008-model-driven-workspace-authz/tasks.md:81`, `package.json:18`, `scripts/validate-structure.mjs:118` |
| `scripts/validate-deployment-chart.mjs` | product | 1 | `openspec/changes/fix-980-mongo-bearer-executor-route/proposal.md:25`, `openspec/changes/fix-980-mongo-bearer-executor-route/tasks.md:213`, `openspec/changes/fix-980-mongo-bearer-executor-route/tasks.md:246`, `package.json:17` |
| `scripts/validate-deployment-topology.mjs` | product | 1 | `openspec/changes/fix-980-mongo-bearer-executor-route/tasks.md:87`, `openspec/changes/fix-980-mongo-bearer-executor-route/tasks.md:89`, `openspec/changes/fix-980-mongo-bearer-executor-route/tasks.md:102`, `openspec/changes/fix-980-mongo-bearer-executor-route/tasks.md:104` |
| `scripts/validate-domain-model.mjs` | product | 1 | `package.json:52`, `scripts/validate-structure.mjs:119` |
| `scripts/validate-gateway-policy.mjs` | product | 1 | `openspec/changes/fix-1012-postgres-bearer-executor-route/tasks.md:25`, `package.json:53` |
| `scripts/validate-image-policy.mjs` | product | 1 | `docs/installation/function-invocation-isolation.md:185`, `package.json:10`, `scripts/validate-structure.mjs:112` |
| `scripts/validate-observability-audit-correlation-surface.mjs` | product | 1 | `package.json:57` |
| `scripts/validate-observability-audit-event-schema.mjs` | product | 1 | `package.json:27` |
| `scripts/validate-observability-audit-export-surface.mjs` | product | 1 | `package.json:56` |
| `scripts/validate-observability-audit-pipeline.mjs` | product | 1 | `package.json:26` |
| `scripts/validate-observability-audit-query-surface.mjs` | product | 1 | `package.json:55` |
| `scripts/validate-observability-business-metrics.mjs` | product | 1 | `package.json:21` |
| `scripts/validate-observability-console-alerts.mjs` | product | 1 | `package.json:22`, `tests/contracts/observability-console-alerts.contract.test.mjs:88` |
| `scripts/validate-observability-dashboards.mjs` | product | 1 | `package.json:20` |
| `scripts/validate-observability-hard-limit-enforcement.mjs` | product | 1 | `package.json:25` |
| `scripts/validate-observability-health-checks.mjs` | product | 1 | `package.json:54` |
| `scripts/validate-observability-metrics-stack.mjs` | product | 1 | `package.json:19` |
| `scripts/validate-observability-quota-policies.mjs` | product | 1 | `package.json:23` |
| `scripts/validate-observability-quota-usage-view.mjs` | product | 1 | `package.json:59` |
| `scripts/validate-observability-threshold-alerts.mjs` | product | 1 | `package.json:24` |
| `scripts/validate-observability-usage-consumption.mjs` | product | 1 | `package.json:58` |
| `scripts/validate-openapi.mjs` | product | 1 | `package.json:9`, `scripts/validate-structure.mjs:111` |
| `scripts/validate-postgresql-tenant-isolation.mjs` | product | 1 | `package.json:8` |
| `scripts/validate-public-api.mjs` | product | 1 | `openspec/changes/fix-980-mongo-bearer-executor-route/tasks.md:122`, `package.json:15` |
| `scripts/validate-service-catalog.mjs` | product | 1 | `package.json:13`, `scripts/validate-structure.mjs:115` |
| `scripts/validate-service-map.mjs` | product | 1 | `package.json:12`, `scripts/validate-structure.mjs:114` |
| `scripts/validate-structure.mjs` | product | 1 | `falcone-loop-state/FINDINGS.md:950`, `package.json:7`, `tests/blackbox/nonroot-numeric-uid.test.mjs:133` |
| `scripts/validate-testing-strategy.mjs` | product | 1 | `package.json:11`, `scripts/validate-structure.mjs:113` |
| `scripts/verify-secret-storage.sh` | product | 1 | `scripts/verify-secret-storage.sh:4` |
| `service-catalog.json` | product | 1 | `README.de.md:285`, `README.es.md:282`, `README.fr.md:286`, `README.md:285` |
| `spikes/add-flows-adr-temporal-spikes/**` | process | 28 | `docs-site/architecture/adrs.md:98`, `spikes/add-flows-adr-temporal-spikes/README.md:23`, `spikes/add-flows-adr-temporal-spikes/spike-a/evidence/kill-resume-history.json:325`, `spikes/add-flows-adr-temporal-spikes/spike-a/evidence/notes.md:6` |
| `spikes/add-mcp-control-plane-runtime/**` | process | 1 | no reader found |
| `spikes/add-mcp-custom-hosting/**` | process | 2 | no reader found |
| `spikes/add-mcp-hosting-adr-spikes/**` | process | 6 | `docs-site/architecture/adrs.md:116`, `spikes/add-mcp-hosting-adr-spikes/README.md:19` |
| `spikes/add-mcp-oauth-authorization-server/**` | process | 3 | no reader found |
| `spikes/add-mcp-workflows-as-tools/**` | process | 4 | `spikes/add-mcp-workflows-as-tools/README.md:27`, `spikes/add-mcp-workflows-as-tools/README.md:32` |
| `spikes/add-seaweedfs-storage-adr-spike/**` | process | 21 | `packages/adapters/src/seaweedfs-iam-client.mjs:8`, `packages/provisioning-orchestrator/src/config/seaweedfs-compat-matrix.json:2`, `tests/env/seaweedfs/run.sh:14`, `tests/unit/storage-handlers-xml-parsing.test.mjs:14` |
| `spikes/knative-runtime-alternatives/**` | process | 1 | no reader found |
| `tests/adapters/**` | product | 24 | `openspec/changes/fix-1013-executor-5xx-code-redaction/tasks.md:16`, `openspec/changes/fix-1013-executor-5xx-code-redaction/tasks.md:21`, `openspec/changes/fix-vector-capability-unavailable/tasks.md:23`, `package.json:33` |
| `tests/blackbox/**` | product | 248 | `.github/workflows/ci.yml:58`, `.github/workflows/ci.yml:59`, `.github/workflows/ci.yml:60`, `.github/workflows/ci.yml:64` |
| `tests/contract/**` | product | 17 | `docs/reference/architecture/gateway-authentication-and-passthrough.md:98`, `openspec/changes/fix-1002-storage-get-canonical-route/tasks.md:22`, `openspec/changes/fix-1002-storage-get-canonical-route/tasks.md:33`, `openspec/changes/fix-1009-events-publish-phantom-payload/tasks.md:50` |
| `tests/contracts/**` | product | 95 | `docs/reference/architecture/gateway-authentication-and-passthrough.md:98`, `openspec/changes/fix-1002-storage-get-canonical-route/tasks.md:22`, `openspec/changes/fix-1002-storage-get-canonical-route/tasks.md:33`, `openspec/changes/fix-1009-events-publish-phantom-payload/tasks.md:50` |
| `tests/e2e/**` | product | 174 | `.dockerignore:12`, `.github/workflows/ci.yml:198`, `.github/workflows/integration.yml:103`, `.github/workflows/integration.yml:116` |
| `tests/e2e-browser/**` | product | 3 | `tests/integration/plan-enforcement/run-suite.sh:47`, `tests/integration/plan-enforcement/run-suite.sh:48` |
| `tests/env/**` | product | 106 | `.github/workflows/ci.yml:162`, `.github/workflows/ci.yml:351`, `.github/workflows/ci.yml:356`, `.github/workflows/ci.yml:386` |
| `tests/hardening/**` | product | 15 | `package.json:43`, `pnpm-lock.yaml:435`, `pnpm-workspace.yaml:6`, `tests/hardening/README.md:23` |
| `tests/helpers/**` | product | 11 | no reader found |
| `tests/integration/**` | product | 143 | `.github/workflows/ci.yml:174`, `.github/workflows/ci.yml:273`, `.github/workflows/integration.yml:230`, `openspec/changes/fix-980-mongo-bearer-executor-route/tasks.md:40` |
| `tests/reference/**` | product | 7 | `packages/internal-contracts/src/authorization-model.json:69`, `packages/internal-contracts/src/deployment-topology.json:54`, `scripts/lib/audit-traceability.mjs:12`, `scripts/lib/deployment-topology.mjs:6` |
| `tests/resilience/**` | product | 15 | `docs/reference/architecture/gateway-authentication-and-passthrough.md:99`, `package.json:42`, `scripts/validate-structure.mjs:82`, `scripts/validate-structure.mjs:83` |
| `tests/saga/**` | product | 5 | no reader found |
| `tests/scope-enforcement/**` | product | 2 | no reader found |
| `tests/unit/**` | product | 235 | `.github/workflows/ci.yml:276`, `falcone-loop-state/FINDINGS.md:1177`, `openspec/changes/add-759-console-members-invite-wizard/tasks.md:30`, `openspec/changes/add-929-openshift-private-base-images/design.md:39` |
| `tests/workflows/**` | product | 2 | no reader found |
| `tools/falcone-cli/**` | product | 12 | `docs-site/personas/developer.md:70`, `openspec/changes/restructure-service-code-layout/design.md:21`, `pnpm-lock.yaml:453`, `scripts/lib/service-catalog.mjs:382` |
| `tools/migration/**` | product | 25 | `docs-site/.vitepress/config.mts:7`, `docs-site/.vitepress/config.mts:10`, `docs-site/architecture/ferretdb.md:211`, `docs-site/architecture/ferretdb.md:218` |
| `turbo.json` | product | 1 | `scripts/validate-structure.mjs:9` |

### Nested non-product count cross-checks (not extra matching rules)

The rules above cover every file in these subsets. Counts are input and phase-1
counts, unchanged outside the new change directory:

| Subset | Files | Class | Reader evidence at input |
| --- | --- | --- | --- |
| `delivery-adapter/GAP-001/hermes-workflows-suite/**` | 7 | process | no reader found |
| `delivery-adapter/GAP-001/test-fixtures/**` | 1 | process | no reader found |
| `delivery-adapter/GAP-001/tests/**` | 3 | process | no reader found |
| `docs/track-f/prompts/**` | 3 | process | `docs/track-f/falcone-track-getting-started.md:36`, `docs/track-f/falcone-track-getting-started.md:45`, `docs/track-f/falcone-track-getting-started.md:46`, `docs/track-f/falcone-track-getting-started.md:99` |
| `internal-contracts/secrets/**` | 3 | process | no reader found |
| `spikes/add-flows-adr-temporal-spikes/spike-a/evidence/**` | 6 | process | `docs-site/architecture/adrs.md:98`, `spikes/add-flows-adr-temporal-spikes/README.md:23`, `spikes/add-flows-adr-temporal-spikes/spike-a/evidence/kill-resume-history.json:325`, `spikes/add-flows-adr-temporal-spikes/spike-a/evidence/notes.md:6` |
| `spikes/add-flows-adr-temporal-spikes/spike-b/evidence/**` | 1 | process | `docs-site/architecture/adrs.md:98`, `spikes/add-flows-adr-temporal-spikes/README.md:23`, `spikes/add-flows-adr-temporal-spikes/spike-a/evidence/kill-resume-history.json:325`, `spikes/add-flows-adr-temporal-spikes/spike-a/evidence/notes.md:6` |
| `spikes/add-mcp-control-plane-runtime/evidence/**` | 1 | process | no reader found |
| `spikes/add-mcp-custom-hosting/evidence/**` | 1 | process | no reader found |
| `spikes/add-mcp-hosting-adr-spikes/runtime/evidence/**` | 2 | process | `docs-site/architecture/adrs.md:116`, `spikes/add-mcp-hosting-adr-spikes/README.md:19` |
| `spikes/add-mcp-oauth-authorization-server/evidence/**` | 1 | process | no reader found |
| `spikes/add-mcp-workflows-as-tools/evidence/**` | 1 | process | `spikes/add-mcp-workflows-as-tools/README.md:27`, `spikes/add-mcp-workflows-as-tools/README.md:32` |
| `spikes/add-seaweedfs-storage-adr-spike/evidence/**` | 13 | process | `packages/adapters/src/seaweedfs-iam-client.mjs:8`, `packages/provisioning-orchestrator/src/config/seaweedfs-compat-matrix.json:2`, `tests/env/seaweedfs/run.sh:14`, `tests/unit/storage-handlers-xml-parsing.test.mjs:14` |

`scripts/operations/staging-backup-evidence-contract.json:6` uses delivery-adapter
as an evidence **scope string**, not a filesystem read. It is in the design reader
table, along with the snapshot fixture with the same scope. Track-f documents cite loop-state paths as recorded in the reader table. Hermes
reads/writes are operator-described and require external owner confirmation before
phase 2; source citations do not establish its deployed call sites.

## GAP-001 manifest: present subset and missing entries

`delivery-adapter/GAP-001/FILE-SHA256SUMS` SHA256:
`499bed0737145ab22bf053bb9324f050a9e68fa138b9b71b7dd2de8c32c93d07`.
Keep the manifest byte-identical. It lists **153** entries: **11 present**, all
verified against their listed SHA256, and **142 missing**. The README and manifest
are tracked but not listed in this manifest. Missing snapshot files are not restored.
Paths below are relative to GAP-001. Verify only the recorded present subset:

```sh
python3 - <<'PY'
import hashlib, pathlib, subprocess
root = pathlib.Path('delivery-adapter/GAP-001')
tracked = set(subprocess.check_output(['git', 'ls-files'], text=True).splitlines())
present = missing = 0
for line in (root / 'FILE-SHA256SUMS').read_text().splitlines():
    expected, name = line.split(None, 1)
    file = root / name.lstrip('*')
    if str(file) not in tracked:
        missing += 1
        continue
    assert hashlib.sha256(file.read_bytes()).hexdigest() == expected, str(file)
    present += 1
assert (present, missing) == (11, 142), (present, missing)
print('11 present hashes verified; 142 missing entries recorded')
PY
```

| Manifest entry | Status |
| --- | --- |
| `ADAPTER-ENV-HOTFIX-v4.1.3.md` | missing |
| `CHANGELOG-v4.1.md` | missing |
| `CONTROLLER-BROWSER-HOTFIX-v4.1.2.md` | missing |
| `README-FIRST.md` | missing |
| `VERSION` | missing |
| `WORKER-NODE22-HOTFIX-v4.1.1.md` | missing |
| `configure-agent-browser-apparmor.sh` | missing |
| `hermes-workflows-suite/HERMES.md.example` | missing |
| `hermes-workflows-suite/README.md` | missing |
| `hermes-workflows-suite/adapters/common/lib.sh` | present; verified |
| `hermes-workflows-suite/adapters/falcone/adapter.env.example` | present; verified |
| `hermes-workflows-suite/adapters/falcone/backup-evidence.sh` | present; verified |
| `hermes-workflows-suite/adapters/falcone/deploy-branch.sh` | present; verified |
| `hermes-workflows-suite/adapters/falcone/deploy-main.sh` | missing |
| `hermes-workflows-suite/adapters/falcone/lib-migration-waiver.sh` | present; verified |
| `hermes-workflows-suite/adapters/falcone/preflight.sh` | present; verified |
| `hermes-workflows-suite/adapters/falcone/resolve-artifacts.sh` | missing |
| `hermes-workflows-suite/adapters/falcone/rollback.sh` | missing |
| `hermes-workflows-suite/adapters/falcone/runtime-smoke.sh` | missing |
| `hermes-workflows-suite/adapters/falcone/snapshot.sh` | missing |
| `hermes-workflows-suite/adapters/falcone/validate-backup-evidence.sh` | present; verified |
| `hermes-workflows-suite/adapters/falcone/verify-cluster.sh` | missing |
| `hermes-workflows-suite/adapters/llmwiki/adapter.env.example` | missing |
| `hermes-workflows-suite/adapters/llmwiki/deploy-branch.sh` | missing |
| `hermes-workflows-suite/adapters/llmwiki/deploy-main.sh` | missing |
| `hermes-workflows-suite/adapters/llmwiki/preflight.sh` | missing |
| `hermes-workflows-suite/adapters/llmwiki/resolve-artifacts.sh` | missing |
| `hermes-workflows-suite/adapters/llmwiki/rollback.sh` | missing |
| `hermes-workflows-suite/adapters/llmwiki/runtime-smoke.sh` | missing |
| `hermes-workflows-suite/adapters/llmwiki/snapshot.sh` | missing |
| `hermes-workflows-suite/adapters/llmwiki/verify-cluster.sh` | missing |
| `hermes-workflows-suite/adapters/musematic/adapter.env.example` | missing |
| `hermes-workflows-suite/adapters/musematic/deploy-branch.sh` | missing |
| `hermes-workflows-suite/adapters/musematic/deploy-main.sh` | missing |
| `hermes-workflows-suite/adapters/musematic/preflight.sh` | missing |
| `hermes-workflows-suite/adapters/musematic/promote-gitops.sh` | missing |
| `hermes-workflows-suite/adapters/musematic/resolve-artifacts.sh` | missing |
| `hermes-workflows-suite/adapters/musematic/rollback.sh` | missing |
| `hermes-workflows-suite/adapters/musematic/runtime-smoke.sh` | missing |
| `hermes-workflows-suite/adapters/musematic/snapshot.sh` | missing |
| `hermes-workflows-suite/adapters/musematic/verify-cluster.sh` | missing |
| `hermes-workflows-suite/bin/hcluster-login` | missing |
| `hermes-workflows-suite/bin/hdeploy` | missing |
| `hermes-workflows-suite/bin/hflow` | missing |
| `hermes-workflows-suite/bin/hruntime-verify` | missing |
| `hermes-workflows-suite/browser-harness/package.json` | missing |
| `hermes-workflows-suite/browser-harness/playwright.config.mjs` | missing |
| `hermes-workflows-suite/browser-harness/tests/browser-smoke.spec.mjs` | missing |
| `hermes-workflows-suite/config/audit-env.example` | missing |
| `hermes-workflows-suite/config/hermes/config.strict-omniroute.yaml.example` | missing |
| `hermes-workflows-suite/config/projects.d/falcone.yaml` | missing |
| `hermes-workflows-suite/config/projects.d/llmwiki.yaml` | missing |
| `hermes-workflows-suite/config/projects.d/musematic.yaml` | missing |
| `hermes-workflows-suite/docs/CAMPAIGN-LIFECYCLE.md` | missing |
| `hermes-workflows-suite/docs/CONSOLIDATED-TUTORIAL-v4.md` | missing |
| `hermes-workflows-suite/docs/DEPLOYMENT-ADAPTERS-v4.md` | missing |
| `hermes-workflows-suite/docs/ISSUE-DELIVERY-LIFECYCLE.md` | missing |
| `hermes-workflows-suite/docs/MODEL-COST-POLICY.md` | missing |
| `hermes-workflows-suite/docs/OMNIROUTE-HERMES-SETUP.md` | missing |
| `hermes-workflows-suite/docs/PROJECT-DELIVERY-SOURCE-VERIFICATION-v4.md` | missing |
| `hermes-workflows-suite/docs/TUTORIAL-COMPLETO-v4-ES.md` | missing |
| `hermes-workflows-suite/docs/TUTORIAL-v4.1-EN.md` | missing |
| `hermes-workflows-suite/docs/TUTORIAL-v4.1.3-CURRENT-VALID-EN.md` | missing |
| `hermes-workflows-suite/docs/UBUNTU-26.04-BROWSER-PLAYWRIGHT.md` | missing |
| `hermes-workflows-suite/docs/VALIDATION-REPORT-v4.1.md` | missing |
| `hermes-workflows-suite/docs/VALIDATION-REPORT-v4.md` | missing |
| `hermes-workflows-suite/docs/WORKFLOW-MATRIX.md` | missing |
| `hermes-workflows-suite/install.sh` | missing |
| `hermes-workflows-suite/repo-templates/musematic/.github/workflows/hermes-preview-images.yml` | missing |
| `hermes-workflows-suite/runtime-verifiers/falcone.sh.example` | missing |
| `hermes-workflows-suite/runtime-verifiers/llmwiki.sh.example` | missing |
| `hermes-workflows-suite/runtime-verifiers/musematic.sh.example` | missing |
| `hermes-workflows-suite/skills/audit-api/SKILL.md` | missing |
| `hermes-workflows-suite/skills/audit-architecture/SKILL.md` | missing |
| `hermes-workflows-suite/skills/audit-cluster/SKILL.md` | missing |
| `hermes-workflows-suite/skills/audit-code/SKILL.md` | missing |
| `hermes-workflows-suite/skills/audit-dependencies/SKILL.md` | missing |
| `hermes-workflows-suite/skills/audit-product/SKILL.md` | missing |
| `hermes-workflows-suite/skills/audit-runtime-journeys/SKILL.md` | missing |
| `hermes-workflows-suite/skills/audit-security/SKILL.md` | missing |
| `hermes-workflows-suite/skills/audit-ux/SKILL.md` | missing |
| `hermes-workflows-suite/skills/blackbox/SKILL.md` | missing |
| `hermes-workflows-suite/skills/bug-fix/SKILL.md` | missing |
| `hermes-workflows-suite/skills/bug-hunt/SKILL.md` | missing |
| `hermes-workflows-suite/skills/cluster-rollout/SKILL.md` | missing |
| `hermes-workflows-suite/skills/code-cartography/SKILL.md` | missing |
| `hermes-workflows-suite/skills/confirm-findings/SKILL.md` | missing |
| `hermes-workflows-suite/skills/coverage/SKILL.md` | missing |
| `hermes-workflows-suite/skills/e2e-audit/SKILL.md` | missing |
| `hermes-workflows-suite/skills/feature-loop/SKILL.md` | missing |
| `hermes-workflows-suite/skills/findings-github/SKILL.md` | missing |
| `hermes-workflows-suite/skills/fix-loop/SKILL.md` | missing |
| `hermes-workflows-suite/skills/implement-finding/SKILL.md` | missing |
| `hermes-workflows-suite/skills/implement-issue/SKILL.md` | missing |
| `hermes-workflows-suite/skills/issue-delivery/SKILL.md` | missing |
| `hermes-workflows-suite/skills/issue-to-spec/SKILL.md` | missing |
| `hermes-workflows-suite/skills/plan-fixes/SKILL.md` | missing |
| `hermes-workflows-suite/skills/propose-features/SKILL.md` | missing |
| `hermes-workflows-suite/skills/quality-cross/SKILL.md` | missing |
| `hermes-workflows-suite/skills/regression-suite/SKILL.md` | missing |
| `hermes-workflows-suite/skills/release-readiness/SKILL.md` | missing |
| `hermes-workflows-suite/skills/triage-findings/SKILL.md` | missing |
| `hermes-workflows-suite/skills/verify-finding/SKILL.md` | missing |
| `hermes-workflows-suite/templates/EXECUTION-PLAN.md` | missing |
| `hermes-workflows-suite/templates/FINAL-REPORT.md` | missing |
| `hermes-workflows-suite/templates/FINDING.md` | missing |
| `hermes-workflows-suite/templates/REVISION-SET.json` | missing |
| `hermes-workflows-suite/tools/remove-musematic-legacy-updater-annotations.py` | missing |
| `hermes-workflows-suite/tools/update-musematic-argocd-revision.py` | missing |
| `hermes-workflows-suite/tools/update-musematic-image-tags.py` | missing |
| `hermes-workflows-suite/tools/update-musematic-image-updater-pattern.py` | missing |
| `hermes-workflows-suite/tools/update-profile-model-policy.py` | missing |
| `hermes-workflows-suite/tools/validate-musematic-promotion-diff.py` | missing |
| `hmw-hermes-multiworker-kit/HERMES.md.example` | missing |
| `hmw-hermes-multiworker-kit/README.md` | missing |
| `hmw-hermes-multiworker-kit/bin/hmw` | missing |
| `hmw-hermes-multiworker-kit/config/projects.d/falcone-charts.env.example` | missing |
| `hmw-hermes-multiworker-kit/config/projects.d/falcone.env.example` | missing |
| `hmw-hermes-multiworker-kit/config/projects.d/llmwiki.env.example` | missing |
| `hmw-hermes-multiworker-kit/config/projects.d/musematic-deploy.env.example` | missing |
| `hmw-hermes-multiworker-kit/config/projects.d/musematic.env.example` | missing |
| `hmw-hermes-multiworker-kit/config/projects.d/project.env.example` | missing |
| `hmw-hermes-multiworker-kit/config/workers.d/controller.env.example` | missing |
| `hmw-hermes-multiworker-kit/config/workers.d/worker.env.example` | missing |
| `hmw-hermes-multiworker-kit/skills/hmw-audit/SKILL.md` | missing |
| `hmw-hermes-multiworker-kit/skills/hmw-implement/SKILL.md` | missing |
| `hmw-hermes-multiworker-kit/skills/hmw-verify/SKILL.md` | missing |
| `install-ubuntu-26.04-browser-stack.sh` | missing |
| `repair-adapter-runtime-command-quoting.sh` | missing |
| `repair-v4-verifier-side-effects.sh` | missing |
| `test-fixtures/falcone/staging-backup-evidence-contract.json` | present; verified |
| `tests/run-offline-tests.sh` | present; verified |
| `tests/static-validation.py` | missing |
| `tests/test-adapter-env-source.sh` | missing |
| `tests/test-argocd-exact-revisions.sh` | missing |
| `tests/test-artifact-resolvers.sh` | missing |
| `tests/test-browser-scripts-dry-run.sh` | missing |
| `tests/test-environment-guards.sh` | missing |
| `tests/test-falcone-backup-evidence.sh` | present; verified |
| `tests/test-falcone-exact-chart.sh` | missing |
| `tests/test-falcone-upgrade-gates.sh` | present; verified |
| `tests/test-hmw.sh` | missing |
| `tests/test-installer.sh` | missing |
| `tests/test-llmwiki-openshift.sh` | missing |
| `tests/test-musematic-gitops.sh` | missing |
| `tests/test-musematic-secret-safe-diff.sh` | missing |
| `tests/test-openshift-expiry.sh` | missing |
| `tests/test-repair-adapter-runtime-command-quoting.sh` | missing |
| `tests/test-repair-v4-side-effects.sh` | missing |
| `tests/test-update-existing-v4.sh` | missing |
| `update-existing-v4.sh` | missing |
| `validate-browser-stack.sh` | missing |
| `verify-package.sh` | missing |

## Re-runnable phase-1 validation

Run the following from the source root at the committed phase-1 head. It checks
Git's public tracked/ignored-file seam, exact stored outputs, disjoint coverage,
reader citations, permitted diff statuses and the unchanged manifest. It creates
and removes one ignored IDE fixture; it does not change tracked files.

```sh
python3 - <<'PY'
import hashlib
import pathlib
import re
import subprocess

root = pathlib.Path.cwd()
git = ['git', '-c', f'safe.directory={root}']
base = 'dead4806656a400a0d6db86a74e0f210c6aee6e9'
change = 'openspec/changes/restructure-repository-agent-material'

def run(*args):
    return subprocess.check_output(git + list(args), text=True)

doc = (root / change / 'inventory.md').read_text()
paths = run('ls-files').splitlines()
for heading, expected in [
    ('Stored top-level output', sorted({p.split('/')[0] for p in paths})),
    ('Stored second-level output', sorted({'/'.join(p.split('/')[:2]) for p in paths})),
    ('Stored full phase-1 git ls-files output', paths),
]:
    stored = doc.split('## ' + heading + '\n', 1)[1].split('```text\n', 1)[1].split('\n```', 1)[0].splitlines()
    assert stored == expected, heading

section = doc.split('## Disjoint recursive classification rules\n', 1)[1].split('### Nested', 1)[0]
rules = []
for line in section.splitlines():
    if line.startswith('| `'):
        pattern, category, count, citation = [s.strip() for s in line.strip('|').split('|')]
        assert category in {'product', 'process', 'agent-memory', 'obsolete'}
        assert ':' in citation or citation == 'no reader found'
        rules.append((pattern.strip('`'), int(count)))

def matches(path, pattern):
    return path.startswith(pattern[:-2]) if pattern.endswith('/**') else path == pattern

for path in paths:
    assert sum(matches(path, pattern) for pattern, _ in rules) == 1, path
for pattern, count in rules:
    assert sum(matches(path, pattern) for path in paths) == count, pattern

assert len(paths) == 3164
assert len(run('ls-files', 'openspec').splitlines()) == 119
assert not run('ls-files', '.idea')
assert (root / '.gitignore').read_text().splitlines()[49] == '/openspec/'
assert '/.idea/' in (root / '.gitignore').read_text().splitlines()
idea = root / '.idea'
idea.mkdir(exist_ok=True)
workspace = idea / 'workspace.xml'
assert not workspace.exists()
try:
    workspace.write_text('<project/>\n')
    assert run('check-ignore', '.idea/workspace.xml').strip() == '.idea/workspace.xml'
    assert 'workspace.xml' not in run('status', '--short', '--untracked-files=all', '--', '.idea')
finally:
    workspace.unlink()
    idea.rmdir()

manifest = root / 'delivery-adapter/GAP-001/FILE-SHA256SUMS'
assert hashlib.sha256(manifest.read_bytes()).hexdigest() == '499bed0737145ab22bf053bb9324f050a9e68fa138b9b71b7dd2de8c32c93d07'
present = missing = 0
for line in manifest.read_text().splitlines():
    digest, name = line.split(None, 1)
    file = manifest.parent / name.lstrip('*')
    if file.relative_to(root).as_posix() in paths:
        assert hashlib.sha256(file.read_bytes()).hexdigest() == digest, name
        present += 1
    else:
        missing += 1
assert (present, missing) == (11, 142)

baseline = set(run('ls-tree', '-r', '--name-only', base).splitlines())
removed = {'.idea/.gitignore', '.idea/atelier.iml', '.idea/modules.xml', '.idea/vcs.xml'}
added = {'CONTRIBUTING.md'} | {f'{change}/{name}.md' for name in ['proposal', 'design', 'tasks', 'inventory']}
assert set(paths) == baseline - removed | added
# Compare the index during implementation and HEAD after the local commit.
diff = run('diff', '--cached', '--name-status', base)
if not diff:
    diff = run('diff', '--name-status', base, 'HEAD')
changes = [line.split('\t') for line in diff.splitlines()]
allowed = removed | added | {'.gitignore', 'README.md'}
assert {p for status, p in changes} == allowed
for status, path in changes:
    assert status == ('D' if path in removed else 'A' if path in added else 'M'), path

design = (root / change / 'design.md').read_text()
hits = subprocess.run(git + ['grep', '-n', '-I', '-e', 'spikes/', '-e', 'falcone-loop-state', '-e', 'delivery-adapter', '-e', 'track-f', base, '--'], capture_output=True, text=True, check=True).stdout.splitlines()
for line in hits:
    _, file, number, _ = line.split(':', 3)
    assert f'`{file}:{number}`' in design, (file, number)
assert len(hits) == 41
assert not run('diff', '--check', base)
print('PASS: 3164 stored paths, 138 disjoint rules/counts, 41 reader citations, IDE ignore/scope, 11 manifest hashes; protected paths unchanged.')
PY
```

## Stored top-level output

```text
.dockerignore
.env.example
.github
.gitignore
.markdownlint-cli2.jsonc
CONTRIBUTING.md
LICENSE
README.de.md
README.es.md
README.fr.md
README.md
README.ru.md
README.zh.md
apps
delivery-adapter
deploy
docs
docs-site
falcone-loop-state
internal-contracts
logo-original.png
logo.svg
openspec
package.json
packages
pnpm-lock.yaml
pnpm-workspace.yaml
scripts
service-catalog.json
spikes
tests
tools
turbo.json
```

## Stored second-level output

```text
.dockerignore
.env.example
.github/workflows
.gitignore
.markdownlint-cli2.jsonc
CONTRIBUTING.md
LICENSE
README.de.md
README.es.md
README.fr.md
README.md
README.ru.md
README.zh.md
apps/console
apps/control-plane
apps/control-plane-executor
apps/fn-runtime
apps/mcp-runtime
apps/web-console
apps/workflow-worker
delivery-adapter/GAP-001
deploy/OPENSHIFT-HARBOR-REVIEW.md
deploy/apisix
deploy/gateway-config
deploy/k8s
deploy/keycloak-config
deploy/kind
docs-site/.vitepress
docs-site/api
docs-site/architecture
docs-site/contributing
docs-site/guide
docs-site/index.md
docs-site/operations
docs-site/package.json
docs-site/personas
docs-site/public
docs/installation
docs/reference
docs/track-f
falcone-loop-state/CAPABILITIES.md
falcone-loop-state/COVERAGE.md
falcone-loop-state/FINDINGS.md
falcone-loop-state/RUNLOG.md
falcone-loop-state/TEST-PLAN.md
internal-contracts/secrets
logo-original.png
logo.svg
openspec/changes
package.json
packages/adapters
packages/audit
packages/audit-anomaly-handler
packages/backup-status
packages/billing-export
packages/event-gateway
packages/internal-contracts
packages/mcp-server-sdk
packages/mongo-cdc-bridge
packages/openapi-sdk-service
packages/pg-cdc-bridge
packages/provisioning-orchestrator
packages/realtime-gateway
packages/scheduling-engine
packages/secret-audit-handler
packages/webhook-engine
packages/workspace-docs-service
pnpm-lock.yaml
pnpm-workspace.yaml
scripts/backfill-ferretdb-tenant-identities.mjs
scripts/backfill-seaweedfs-identities.mjs
scripts/backfill-tenant-realm-audience.mjs
scripts/backfill-tenant-realm-identity-claims.mjs
scripts/check-control-plane-routes.mjs
scripts/generate-public-api-artifacts.mjs
scripts/lib
scripts/lint-snippet-templates.mjs
scripts/lint-snippet-templates.test.mjs
scripts/operations
scripts/realtime-snippet-templates.data.mjs
scripts/system-changes
scripts/validate-authorization-model.mjs
scripts/validate-deployment-chart.mjs
scripts/validate-deployment-topology.mjs
scripts/validate-domain-model.mjs
scripts/validate-gateway-policy.mjs
scripts/validate-image-policy.mjs
scripts/validate-observability-audit-correlation-surface.mjs
scripts/validate-observability-audit-event-schema.mjs
scripts/validate-observability-audit-export-surface.mjs
scripts/validate-observability-audit-pipeline.mjs
scripts/validate-observability-audit-query-surface.mjs
scripts/validate-observability-business-metrics.mjs
scripts/validate-observability-console-alerts.mjs
scripts/validate-observability-dashboards.mjs
scripts/validate-observability-hard-limit-enforcement.mjs
scripts/validate-observability-health-checks.mjs
scripts/validate-observability-metrics-stack.mjs
scripts/validate-observability-quota-policies.mjs
scripts/validate-observability-quota-usage-view.mjs
scripts/validate-observability-threshold-alerts.mjs
scripts/validate-observability-usage-consumption.mjs
scripts/validate-openapi.mjs
scripts/validate-postgresql-tenant-isolation.mjs
scripts/validate-public-api.mjs
scripts/validate-service-catalog.mjs
scripts/validate-service-map.mjs
scripts/validate-structure.mjs
scripts/validate-testing-strategy.mjs
scripts/verify-secret-storage.sh
service-catalog.json
spikes/add-flows-adr-temporal-spikes
spikes/add-mcp-control-plane-runtime
spikes/add-mcp-custom-hosting
spikes/add-mcp-hosting-adr-spikes
spikes/add-mcp-oauth-authorization-server
spikes/add-mcp-workflows-as-tools
spikes/add-seaweedfs-storage-adr-spike
spikes/knative-runtime-alternatives
tests/adapters
tests/blackbox
tests/contract
tests/contracts
tests/e2e
tests/e2e-browser
tests/env
tests/hardening
tests/helpers
tests/integration
tests/reference
tests/resilience
tests/saga
tests/scope-enforcement
tests/unit
tests/workflows
tools/falcone-cli
tools/migration
turbo.json
```

## Stored full phase-1 git ls-files output

```text
.dockerignore
.env.example
.github/workflows/ci.yml
.github/workflows/deploy-docs.yml
.github/workflows/integration.yml
.github/workflows/release-images.yml
.gitignore
.markdownlint-cli2.jsonc
CONTRIBUTING.md
LICENSE
README.de.md
README.es.md
README.fr.md
README.md
README.ru.md
README.zh.md
apps/console/src/components/backup/AuditEventDetail.tsx
apps/console/src/components/backup/AuditEventFilters.tsx
apps/console/src/components/backup/AuditEventTable.tsx
apps/console/src/components/backup/AuditEventTypeBadge.tsx
apps/console/src/hooks/useAuditEvents.ts
apps/console/src/lib/api/backup-audit.api.ts
apps/console/src/pages/admin/BackupAuditPage.tsx
apps/console/src/pages/tenant/BackupAuditSummaryPage.tsx
apps/control-plane-executor/Dockerfile
apps/control-plane-executor/openapi/control-plane.openapi.json
apps/control-plane-executor/openapi/families/auth.openapi.json
apps/control-plane-executor/openapi/families/events.openapi.json
apps/control-plane-executor/openapi/families/flows.openapi.json
apps/control-plane-executor/openapi/families/functions.openapi.json
apps/control-plane-executor/openapi/families/iam.openapi.json
apps/control-plane-executor/openapi/families/mcp.openapi.json
apps/control-plane-executor/openapi/families/metrics.openapi.json
apps/control-plane-executor/openapi/families/mongo-capture-tenant-summary.openapi.json
apps/control-plane-executor/openapi/families/mongo-captures.openapi.json
apps/control-plane-executor/openapi/families/mongo.openapi.json
apps/control-plane-executor/openapi/families/pg-capture-tenant-summary.openapi.json
apps/control-plane-executor/openapi/families/pg-captures.openapi.json
apps/control-plane-executor/openapi/families/platform.openapi.json
apps/control-plane-executor/openapi/families/postgres.openapi.json
apps/control-plane-executor/openapi/families/storage.openapi.json
apps/control-plane-executor/openapi/families/tenants.openapi.json
apps/control-plane-executor/openapi/families/websockets.openapi.json
apps/control-plane-executor/openapi/families/workspaces.openapi.json
apps/control-plane-executor/package.json
apps/control-plane-executor/src/authorization-model.mjs
apps/control-plane-executor/src/console-auth.mjs
apps/control-plane-executor/src/console-backend-functions.mjs
apps/control-plane-executor/src/domain-model.mjs
apps/control-plane-executor/src/events-admin.mjs
apps/control-plane-executor/src/external-application-iam.mjs
apps/control-plane-executor/src/functions-admin.mjs
apps/control-plane-executor/src/functions-audit.mjs
apps/control-plane-executor/src/functions-import-export.mjs
apps/control-plane-executor/src/iam-admin.mjs
apps/control-plane-executor/src/iam-governance.mjs
apps/control-plane-executor/src/iam-tenant-roles.mjs
apps/control-plane-executor/src/internal-service-map.mjs
apps/control-plane-executor/src/mcp-authoring.mjs
apps/control-plane-executor/src/mcp-authoring.test.mjs
apps/control-plane-executor/src/mcp-config.mjs
apps/control-plane-executor/src/mcp-config.test.mjs
apps/control-plane-executor/src/mcp-curation.mjs
apps/control-plane-executor/src/mcp-curation.test.mjs
apps/control-plane-executor/src/mcp-custom-hosting.mjs
apps/control-plane-executor/src/mcp-custom-hosting.test.mjs
apps/control-plane-executor/src/mcp-instant-generator.mjs
apps/control-plane-executor/src/mcp-instant-generator.test.mjs
apps/control-plane-executor/src/mcp-oauth.mjs
apps/control-plane-executor/src/mcp-oauth.test.mjs
apps/control-plane-executor/src/mcp-observability.mjs
apps/control-plane-executor/src/mcp-observability.test.mjs
apps/control-plane-executor/src/mcp-official-catalog.mjs
apps/control-plane-executor/src/mcp-official-server.mjs
apps/control-plane-executor/src/mcp-official-server.test.mjs
apps/control-plane-executor/src/mcp-quota.mjs
apps/control-plane-executor/src/mcp-quota.test.mjs
apps/control-plane-executor/src/mcp-registry.mjs
apps/control-plane-executor/src/mcp-registry.test.mjs
apps/control-plane-executor/src/mcp-workflows-tools.mjs
apps/control-plane-executor/src/mcp-workflows-tools.test.mjs
apps/control-plane-executor/src/mongo-admin.mjs
apps/control-plane-executor/src/mongo-data-api.mjs
apps/control-plane-executor/src/observability-admin.mjs
apps/control-plane-executor/src/observability-audit-correlation.mjs
apps/control-plane-executor/src/observability-audit-export.mjs
apps/control-plane-executor/src/observability-audit-query.mjs
apps/control-plane-executor/src/postgres-admin.mjs
apps/control-plane-executor/src/postgres-data-api.mjs
apps/control-plane-executor/src/public-api-catalog.mjs
apps/control-plane-executor/src/runtime/api-keys.mjs
apps/control-plane-executor/src/runtime/auth-roles.mjs
apps/control-plane-executor/src/runtime/byok-provider-guard.mjs
apps/control-plane-executor/src/runtime/connection-registry.mjs
apps/control-plane-executor/src/runtime/embedding-executor.mjs
apps/control-plane-executor/src/runtime/errors.mjs
apps/control-plane-executor/src/runtime/events-executor.mjs
apps/control-plane-executor/src/runtime/execution-token.mjs
apps/control-plane-executor/src/runtime/flow-audit-relay.mjs
apps/control-plane-executor/src/runtime/flow-audit-relay.test.mjs
apps/control-plane-executor/src/runtime/flow-audit-schema.test.mjs
apps/control-plane-executor/src/runtime/flow-executor.mjs
apps/control-plane-executor/src/runtime/flow-monitoring-executor.mjs
apps/control-plane-executor/src/runtime/flow-quota-gate.mjs
apps/control-plane-executor/src/runtime/flow-task-types.mjs
apps/control-plane-executor/src/runtime/flow-trigger-registry.mjs
apps/control-plane-executor/src/runtime/flow-trigger-secret-crypto.mjs
apps/control-plane-executor/src/runtime/functions-executor.mjs
apps/control-plane-executor/src/runtime/jwt-verify.mjs
apps/control-plane-executor/src/runtime/llm-executor.mjs
apps/control-plane-executor/src/runtime/main.mjs
apps/control-plane-executor/src/runtime/mcp-engine.mjs
apps/control-plane-executor/src/runtime/mcp-engine.test.mjs
apps/control-plane-executor/src/runtime/mcp-pg-store.mjs
apps/control-plane-executor/src/runtime/mcp-runtime-adapter.mjs
apps/control-plane-executor/src/runtime/mcp-runtime-cleaner.mjs
apps/control-plane-executor/src/runtime/mcp-runtime-namespace.mjs
apps/control-plane-executor/src/runtime/metrics-registry.mjs
apps/control-plane-executor/src/runtime/mongo-data-executor.mjs
apps/control-plane-executor/src/runtime/postgres-data-executor.mjs
apps/control-plane-executor/src/runtime/postgres-ddl-executor.mjs
apps/control-plane-executor/src/runtime/postgres-realtime-executor.mjs
apps/control-plane-executor/src/runtime/realtime-executor.mjs
apps/control-plane-executor/src/runtime/sa-revocation.mjs
apps/control-plane-executor/src/runtime/server.mjs
apps/control-plane-executor/src/runtime/vector-capability.mjs
apps/control-plane-executor/src/runtime/workspace-dsn-resolver.mjs
apps/control-plane-executor/src/saga/index.mjs
apps/control-plane-executor/src/saga/saga-compensation.mjs
apps/control-plane-executor/src/saga/saga-config.mjs
apps/control-plane-executor/src/saga/saga-correlation.mjs
apps/control-plane-executor/src/saga/saga-definitions.mjs
apps/control-plane-executor/src/saga/saga-engine.mjs
apps/control-plane-executor/src/saga/saga-idempotency.mjs
apps/control-plane-executor/src/saga/saga-state-store.mjs
apps/control-plane-executor/src/saga/saga-status.mjs
apps/control-plane-executor/src/storage-admin.mjs
apps/control-plane-executor/src/tenant-data-residency.mjs
apps/control-plane-executor/src/tenant-management.mjs
apps/control-plane-executor/src/tenant-role-storage.mjs
apps/control-plane-executor/src/workflows/idempotency-store.mjs
apps/control-plane-executor/src/workflows/index.mjs
apps/control-plane-executor/src/workflows/job-status.mjs
apps/control-plane-executor/src/workflows/wf-con-001-user-approval.mjs
apps/control-plane-executor/src/workflows/wf-con-001.mjs
apps/control-plane-executor/src/workflows/wf-con-002-tenant-provisioning.mjs
apps/control-plane-executor/src/workflows/wf-con-002.mjs
apps/control-plane-executor/src/workflows/wf-con-003-workspace-creation.mjs
apps/control-plane-executor/src/workflows/wf-con-003.mjs
apps/control-plane-executor/src/workflows/wf-con-004-credential-generation.mjs
apps/control-plane-executor/src/workflows/wf-con-004.mjs
apps/control-plane-executor/src/workflows/wf-con-006-service-account.mjs
apps/control-plane-executor/src/workflows/wf-con-006.mjs
apps/control-plane-executor/src/workflows/workflow-audit.mjs
apps/control-plane-executor/src/workflows/workflow-invocation-contract.mjs
apps/control-plane-executor/src/workspace-management.mjs
apps/control-plane/Dockerfile
apps/control-plane/application-handlers.mjs
apps/control-plane/audit-hash.mjs
apps/control-plane/audit-store.mjs
apps/control-plane/audit-writer.mjs
apps/control-plane/auth-handlers.mjs
apps/control-plane/b-handlers.mjs
apps/control-plane/control-plane-database-startup.mjs
apps/control-plane/control-plane-startup.mjs
apps/control-plane/dataplane.mjs
apps/control-plane/dimension-quota.mjs
apps/control-plane/executor-rbac.yaml
apps/control-plane/fn-handlers.mjs
apps/control-plane/function-executor.mjs
apps/control-plane/function-invocation-auth.mjs
apps/control-plane/governance-schema.mjs
apps/control-plane/health-response.mjs
apps/control-plane/invitation-handlers.mjs
apps/control-plane/jwt-verify.mjs
apps/control-plane/kafka-handlers.mjs
apps/control-plane/kc-admin.mjs
apps/control-plane/keycloak-public-base.mjs
apps/control-plane/knative-runtime-handlers.mjs
apps/control-plane/knative-runtime.mjs
apps/control-plane/kubernetes-api.mjs
apps/control-plane/metrics-handlers.mjs
apps/control-plane/metrics-registry.mjs
apps/control-plane/model-authz.mjs
apps/control-plane/mongo-handlers.mjs
apps/control-plane/package.json
apps/control-plane/pg-handlers.mjs
apps/control-plane/realtime-handlers.mjs
apps/control-plane/request-body.mjs
apps/control-plane/required-migrations.txt
apps/control-plane/route-invoke.mjs
apps/control-plane/route-map.allowlist.json
apps/control-plane/route-map.json
apps/control-plane/route-map.runtime.json
apps/control-plane/route-table.mjs
apps/control-plane/routes.mjs
apps/control-plane/runtime-cleanup-repository.mjs
apps/control-plane/runtime-teardown-coordinator.mjs
apps/control-plane/sa-revocation.mjs
apps/control-plane/saga.mjs
apps/control-plane/schema-retry.mjs
apps/control-plane/seaweedfs-identity.mjs
apps/control-plane/server.mjs
apps/control-plane/social-providers.mjs
apps/control-plane/storage-handlers.mjs
apps/control-plane/storage-quota.mjs
apps/control-plane/tenant-config-export.mjs
apps/control-plane/tenant-scope.mjs
apps/control-plane/tenant-store.mjs
apps/control-plane/tenant-user-handlers.mjs
apps/control-plane/transport-security.mjs
apps/control-plane/vault-secrets.mjs
apps/control-plane/webhook-database-principals.mjs
apps/control-plane/webhook-db.mjs
apps/control-plane/webhook-handlers.mjs
apps/control-plane/webhook-key-credential-cli.mjs
apps/control-plane/webhook-key-lifecycle-cli.mjs
apps/control-plane/webhook-key-runtime.mjs
apps/control-plane/webhook-runtime.mjs
apps/control-plane/webhook-schema.mjs
apps/control-plane/workspace-iam-client-handlers.mjs
apps/control-plane/workspace-iam-context.mjs
apps/control-plane/workspace-quota.mjs
apps/fn-runtime/Dockerfile
apps/fn-runtime/invocation-auth.mjs
apps/fn-runtime/server.mjs
apps/mcp-runtime/Dockerfile
apps/mcp-runtime/server.mjs
apps/web-console/Dockerfile
apps/web-console/e2e/console-auth-flows.e2e.ts
apps/web-console/e2e/console-context-auth-e2e.e2e.ts
apps/web-console/e2e/console-service-e2e.e2e.ts
apps/web-console/e2e/fixtures/context-auth-e2e.ts
apps/web-console/e2e/fixtures/service-e2e.ts
apps/web-console/e2e/workspace-docs.spec.ts
apps/web-console/index.html
apps/web-console/nginx.conf
apps/web-console/package.json
apps/web-console/playwright.config.ts
apps/web-console/postcss.config.cjs
apps/web-console/public/favicon.png
apps/web-console/public/favicon.svg
apps/web-console/public/img/icon-180.png
apps/web-console/public/img/icon-192.png
apps/web-console/public/img/logo-wide.png
apps/web-console/src/__tests__/BackupScopeMatrix.test.tsx
apps/web-console/src/__tests__/ConfigExportDomainSelector.test.tsx
apps/web-console/src/__tests__/ConfigExportResultPanel.test.tsx
apps/web-console/src/__tests__/ConsoleBackupScopePage.test.tsx
apps/web-console/src/__tests__/ConsoleDocsPage.test.tsx
apps/web-console/src/__tests__/ConsoleTenantConfigExportPage.test.tsx
apps/web-console/src/__tests__/ConsoleTenantConfigPreflightPage.test.tsx
apps/web-console/src/__tests__/ConsoleTenantConfigReprovisionPage.test.tsx
apps/web-console/src/__tests__/FlowConnectionRules.test.ts
apps/web-console/src/__tests__/FlowGraphModel.test.tsx
apps/web-console/src/__tests__/FlowSemanticMarkers.test.ts
apps/web-console/src/__tests__/FlowSemanticValidation.test.ts
apps/web-console/src/__tests__/FlowViewSwitcher.test.tsx
apps/web-console/src/__tests__/FlowViewSync.test.ts
apps/web-console/src/__tests__/FlowYamlEditor.test.tsx
apps/web-console/src/__tests__/FlowYamlRoundTrip.test.ts
apps/web-console/src/__tests__/PostgresDataEditor.test.tsx
apps/web-console/src/__tests__/WorkspaceDocNotes.test.tsx
apps/web-console/src/__tests__/WorkspaceDocSections.test.tsx
apps/web-console/src/__tests__/fixtures/backupScopeFixtures.ts
apps/web-console/src/actions/observability-audit-correlation.mjs
apps/web-console/src/actions/observability-audit-export.mjs
apps/web-console/src/actions/observability-audit.mjs
apps/web-console/src/actions/observability-quota-usage.mjs
apps/web-console/src/actions/postgres-admin.mjs
apps/web-console/src/actions/public-api-catalog.mjs
apps/web-console/src/actions/secretRotationActions.ts
apps/web-console/src/actions/tenant-management.mjs
apps/web-console/src/actions/workspace-management.mjs
apps/web-console/src/api/configExportApi.ts
apps/web-console/src/api/configPreflightApi.ts
apps/web-console/src/api/configReprovisionApi.ts
apps/web-console/src/api/configSchemaApi.ts
apps/web-console/src/components/ConfigArtifactValidator.tsx
apps/web-console/src/components/ConfigExportDomainSelector.tsx
apps/web-console/src/components/ConfigExportResultPanel.tsx
apps/web-console/src/components/ConfigIdentifierMapEditor.test.tsx
apps/web-console/src/components/ConfigIdentifierMapEditor.tsx
apps/web-console/src/components/ConfigReprovisionResultPanel.tsx
apps/web-console/src/components/PreflightConflictReport.tsx
apps/web-console/src/components/PreflightRiskBadge.tsx
apps/web-console/src/components/RouteErrorBoundary.test.tsx
apps/web-console/src/components/RouteErrorBoundary.tsx
apps/web-console/src/components/auth/ProtectedRoute.session-invalidation.test.tsx
apps/web-console/src/components/auth/ProtectedRoute.test.tsx
apps/web-console/src/components/auth/ProtectedRoute.tsx
apps/web-console/src/components/backup/BackupNotAvailable.tsx
apps/web-console/src/components/backup/BackupStatusBadge.tsx
apps/web-console/src/components/backup/BackupStatusDetail.tsx
apps/web-console/src/components/backup/BackupStatusTable.tsx
apps/web-console/src/components/backup/BackupSummaryCard.tsx
apps/web-console/src/components/backup/CriticalConfirmationPanel.tsx
apps/web-console/src/components/backup/OperationHistoryPanel.tsx
apps/web-console/src/components/backup/OperationStatusBadge.tsx
apps/web-console/src/components/backup/PrecheckResultList.tsx
apps/web-console/src/components/backup/RestoreConfirmationDialog.tsx
apps/web-console/src/components/backup/RestoreSimulationDialog.tsx
apps/web-console/src/components/backup/RestoreSimulationEvidence.tsx
apps/web-console/src/components/backup/RiskLevelBadge.tsx
apps/web-console/src/components/backup/SnapshotSelector.tsx
apps/web-console/src/components/backup/TenantNameInput.tsx
apps/web-console/src/components/backup/TriggerBackupButton.tsx
apps/web-console/src/components/backup/__tests__/RestoreConfirmationDialog.test.tsx
apps/web-console/src/components/backup/__tests__/RestoreSimulationDialog.test.tsx
apps/web-console/src/components/backup/__tests__/TenantNameInput.test.tsx
apps/web-console/src/components/console/ActiveOperationsIndicator.test.tsx
apps/web-console/src/components/console/ActiveOperationsIndicator.tsx
apps/web-console/src/components/console/BackupScopeLegend.test.tsx
apps/web-console/src/components/console/BackupScopeLegend.tsx
apps/web-console/src/components/console/BackupScopeMatrix.tsx
apps/web-console/src/components/console/BackupScopeProfileSelector.tsx
apps/web-console/src/components/console/CapabilityGate.test.tsx
apps/web-console/src/components/console/CapabilityGate.tsx
apps/web-console/src/components/console/CapabilityStatusGrid.test.tsx
apps/web-console/src/components/console/CapabilityStatusGrid.tsx
apps/web-console/src/components/console/ConnectionSnippets.test.tsx
apps/web-console/src/components/console/ConnectionSnippets.tsx
apps/web-console/src/components/console/ConsoleAuditCategoryBadge.tsx
apps/web-console/src/components/console/ConsoleAuditRecordDetail.tsx
apps/web-console/src/components/console/ConsoleAuditResultBadge.tsx
apps/web-console/src/components/console/ConsoleCredentialStatusBadge.test.tsx
apps/web-console/src/components/console/ConsoleCredentialStatusBadge.tsx
apps/web-console/src/components/console/ConsoleInvitationList.test.tsx
apps/web-console/src/components/console/ConsoleInvitationList.tsx
apps/web-console/src/components/console/ConsoleMetricDimensionRow.test.tsx
apps/web-console/src/components/console/ConsoleMetricDimensionRow.tsx
apps/web-console/src/components/console/ConsolePageState.test.tsx
apps/web-console/src/components/console/ConsolePageState.tsx
apps/web-console/src/components/console/ConsoleQuotaPostureBadge.test.tsx
apps/web-console/src/components/console/ConsoleQuotaPostureBadge.tsx
apps/web-console/src/components/console/ConsoleTimeRangeSelector.test.tsx
apps/web-console/src/components/console/ConsoleTimeRangeSelector.tsx
apps/web-console/src/components/console/ConsumptionBar.test.tsx
apps/web-console/src/components/console/ConsumptionBar.tsx
apps/web-console/src/components/console/DestructiveConfirmationDialog.integration.test.tsx
apps/web-console/src/components/console/DestructiveConfirmationDialog.test.tsx
apps/web-console/src/components/console/DestructiveConfirmationDialog.tsx
apps/web-console/src/components/console/EventsConsole.test.tsx
apps/web-console/src/components/console/EventsConsole.tsx
apps/web-console/src/components/console/FunctionsConsole.test.tsx
apps/web-console/src/components/console/FunctionsConsole.tsx
apps/web-console/src/components/console/InvitationProofView.tsx
apps/web-console/src/components/console/MongoDataEditor.test.tsx
apps/web-console/src/components/console/MongoDataEditor.tsx
apps/web-console/src/components/console/OpenApiViewer.test.tsx
apps/web-console/src/components/console/OpenApiViewer.tsx
apps/web-console/src/components/console/OperationLogEntriesList.test.tsx
apps/web-console/src/components/console/OperationLogEntriesList.tsx
apps/web-console/src/components/console/OperationResultSummary.test.tsx
apps/web-console/src/components/console/OperationResultSummary.tsx
apps/web-console/src/components/console/OperationStatusBadge.test.tsx
apps/web-console/src/components/console/OperationStatusBadge.tsx
apps/web-console/src/components/console/OperationStatusBanner.test.tsx
apps/web-console/src/components/console/OperationStatusBanner.tsx
apps/web-console/src/components/console/OverrideIndicatorBadge.test.tsx
apps/web-console/src/components/console/OverrideIndicatorBadge.tsx
apps/web-console/src/components/console/PermissionDeniedNotice.test.tsx
apps/web-console/src/components/console/PermissionDeniedNotice.tsx
apps/web-console/src/components/console/PlanAssignmentDialog.test.tsx
apps/web-console/src/components/console/PlanAssignmentDialog.tsx
apps/web-console/src/components/console/PlanCapabilityBadge.test.tsx
apps/web-console/src/components/console/PlanCapabilityBadge.tsx
apps/web-console/src/components/console/PlanCapabilityImpactTable.tsx
apps/web-console/src/components/console/PlanComparisonView.test.tsx
apps/web-console/src/components/console/PlanComparisonView.tsx
apps/web-console/src/components/console/PlanHistoryTable.test.tsx
apps/web-console/src/components/console/PlanHistoryTable.tsx
apps/web-console/src/components/console/PlanImpactHistoryTable.tsx
apps/web-console/src/components/console/PlanImpactSummaryCard.tsx
apps/web-console/src/components/console/PlanLimitsTable.test.tsx
apps/web-console/src/components/console/PlanLimitsTable.tsx
apps/web-console/src/components/console/PlanQuotaImpactTable.tsx
apps/web-console/src/components/console/PlanStatusBadge.test.tsx
apps/web-console/src/components/console/PlanStatusBadge.tsx
apps/web-console/src/components/console/PostgresDataEditor.test.tsx
apps/web-console/src/components/console/PostgresDataEditor.tsx
apps/web-console/src/components/console/QuotaAdjustDialog.test.tsx
apps/web-console/src/components/console/QuotaAdjustDialog.tsx
apps/web-console/src/components/console/QuotaConsumptionTable.test.tsx
apps/web-console/src/components/console/QuotaConsumptionTable.tsx
apps/web-console/src/components/console/ReadOnlyActionBadge.test.tsx
apps/web-console/src/components/console/ReadOnlyActionBadge.tsx
apps/web-console/src/components/console/RealtimeConsole.test.tsx
apps/web-console/src/components/console/RealtimeConsole.tsx
apps/web-console/src/components/console/ScopeEnforcementDenialsTable.test.tsx
apps/web-console/src/components/console/ScopeEnforcementDenialsTable.tsx
apps/web-console/src/components/console/SdkDownloadPanel.test.tsx
apps/web-console/src/components/console/SdkDownloadPanel.tsx
apps/web-console/src/components/console/SpecDownloadButton.test.tsx
apps/web-console/src/components/console/SpecDownloadButton.tsx
apps/web-console/src/components/console/TenantSocialProviderDialog.tsx
apps/web-console/src/components/console/WorkspaceAllocationSummaryTable.test.tsx
apps/web-console/src/components/console/WorkspaceAllocationSummaryTable.tsx
apps/web-console/src/components/console/WorkspaceDocAuthSection.tsx
apps/web-console/src/components/console/WorkspaceDocNotes.tsx
apps/web-console/src/components/console/WorkspaceDocSections.tsx
apps/web-console/src/components/console/WorkspaceRequiredState.test.tsx
apps/web-console/src/components/console/WorkspaceRequiredState.tsx
apps/web-console/src/components/console/hooks/useDestructiveOp.test.ts
apps/web-console/src/components/console/hooks/useDestructiveOp.ts
apps/web-console/src/components/console/hooks/useModalFocusTrap.ts
apps/web-console/src/components/console/mcp/McpServerConnectPanel.test.tsx
apps/web-console/src/components/console/mcp/McpServerConnectPanel.tsx
apps/web-console/src/components/console/mcp/McpServerPlayground.test.tsx
apps/web-console/src/components/console/mcp/McpServerPlayground.tsx
apps/web-console/src/components/console/snippets/RealtimeSnippetsPanel.test.tsx
apps/web-console/src/components/console/snippets/RealtimeSnippetsPanel.tsx
apps/web-console/src/components/console/wizards/CreateIamClientWizard.test.tsx
apps/web-console/src/components/console/wizards/CreateIamClientWizard.tsx
apps/web-console/src/components/console/wizards/CreateTenantWizard.test.tsx
apps/web-console/src/components/console/wizards/CreateTenantWizard.tsx
apps/web-console/src/components/console/wizards/CreateWorkspaceWizard.test.tsx
apps/web-console/src/components/console/wizards/CreateWorkspaceWizard.tsx
apps/web-console/src/components/console/wizards/InviteUserWizard.test.tsx
apps/web-console/src/components/console/wizards/InviteUserWizard.tsx
apps/web-console/src/components/console/wizards/ProvisionDatabaseWizard.test.tsx
apps/web-console/src/components/console/wizards/ProvisionDatabaseWizard.tsx
apps/web-console/src/components/console/wizards/PublishFunctionWizard.test.tsx
apps/web-console/src/components/console/wizards/PublishFunctionWizard.tsx
apps/web-console/src/components/console/wizards/WizardShell.test.tsx
apps/web-console/src/components/console/wizards/WizardShell.tsx
apps/web-console/src/components/console/wizards/WizardStepIndicator.tsx
apps/web-console/src/components/console/wizards/WizardSummaryStep.tsx
apps/web-console/src/components/flows/ConfirmActionDialog.tsx
apps/web-console/src/components/flows/FlowPalette.test.tsx
apps/web-console/src/components/flows/FlowPalette.tsx
apps/web-console/src/components/flows/FlowProblemsPanel.test.tsx
apps/web-console/src/components/flows/FlowProblemsPanel.tsx
apps/web-console/src/components/flows/FlowRunTriggerButton.tsx
apps/web-console/src/components/flows/FlowStatusBadge.test.tsx
apps/web-console/src/components/flows/FlowStatusBadge.tsx
apps/web-console/src/components/flows/FlowViewSwitcher.tsx
apps/web-console/src/components/flows/FlowYamlEditor.tsx
apps/web-console/src/components/flows/MonacoYamlSurface.tsx
apps/web-console/src/components/flows/NodeStatusBadge.test.tsx
apps/web-console/src/components/flows/NodeStatusBadge.tsx
apps/web-console/src/components/flows/RunActionToolbar.test.tsx
apps/web-console/src/components/flows/RunActionToolbar.tsx
apps/web-console/src/components/flows/RunCanvas.tsx
apps/web-console/src/components/flows/RunNodeDetailPanel.tsx
apps/web-console/src/components/flows/connectionRules.ts
apps/web-console/src/components/flows/flowGraphModel.ts
apps/web-console/src/components/flows/nodes/ApprovalNode.tsx
apps/web-console/src/components/flows/nodes/BranchNode.tsx
apps/web-console/src/components/flows/nodes/FlowNodeBadges.test.tsx
apps/web-console/src/components/flows/nodes/NodeShell.test.tsx
apps/web-console/src/components/flows/nodes/NodeShell.tsx
apps/web-console/src/components/flows/nodes/ParallelNode.tsx
apps/web-console/src/components/flows/nodes/RunNode.tsx
apps/web-console/src/components/flows/nodes/SequenceNode.tsx
apps/web-console/src/components/flows/nodes/SubFlowNode.tsx
apps/web-console/src/components/flows/nodes/TaskNode.tsx
apps/web-console/src/components/flows/nodes/WaitNode.tsx
apps/web-console/src/components/flows/nodes/nodeTypes.ts
apps/web-console/src/components/flows/panels/ExpressionField.tsx
apps/web-console/src/components/flows/panels/NodePropertyPanel.test.tsx
apps/web-console/src/components/flows/panels/NodePropertyPanel.tsx
apps/web-console/src/components/flows/panels/RetryPolicyEditor.tsx
apps/web-console/src/components/flows/panels/TaskPropertyPanel.tsx
apps/web-console/src/components/flows/semanticValidation.ts
apps/web-console/src/components/ui/alert.tsx
apps/web-console/src/components/ui/badge.tsx
apps/web-console/src/components/ui/button.tsx
apps/web-console/src/components/ui/card.test.tsx
apps/web-console/src/components/ui/card.tsx
apps/web-console/src/components/ui/checkbox.tsx
apps/web-console/src/components/ui/dialog.test.tsx
apps/web-console/src/components/ui/dialog.tsx
apps/web-console/src/components/ui/input.tsx
apps/web-console/src/components/ui/label.tsx
apps/web-console/src/components/ui/select.tsx
apps/web-console/src/components/ui/separator.tsx
apps/web-console/src/components/ui/table.test.tsx
apps/web-console/src/components/ui/table.tsx
apps/web-console/src/components/ui/tabs.test.tsx
apps/web-console/src/components/ui/tabs.tsx
apps/web-console/src/components/ui/textarea.tsx
apps/web-console/src/hooks/useAbortRestore.ts
apps/web-console/src/hooks/useBackupStatus.ts
apps/web-console/src/hooks/useConfirmRestore.ts
apps/web-console/src/hooks/useDocumentTitle.test.ts
apps/web-console/src/hooks/useDocumentTitle.ts
apps/web-console/src/hooks/useOperationStatus.ts
apps/web-console/src/hooks/useSnapshots.ts
apps/web-console/src/hooks/useTriggerBackup.ts
apps/web-console/src/hooks/useTriggerRestore.ts
apps/web-console/src/layouts/AuthLayout.test.tsx
apps/web-console/src/layouts/AuthLayout.tsx
apps/web-console/src/layouts/ConsoleShellLayout.test.tsx
apps/web-console/src/layouts/ConsoleShellLayout.tsx
apps/web-console/src/lib/backupScopeApi.ts
apps/web-console/src/lib/capabilities/capability-gate-keys.test.ts
apps/web-console/src/lib/capabilities/catalog-keys.ts
apps/web-console/src/lib/console-auth-surface.test.ts
apps/web-console/src/lib/console-auth-surface.ts
apps/web-console/src/lib/console-auth.test.ts
apps/web-console/src/lib/console-auth.ts
apps/web-console/src/lib/console-config.ts
apps/web-console/src/lib/console-context.test.tsx
apps/web-console/src/lib/console-context.tsx
apps/web-console/src/lib/console-create-form-validation.ts
apps/web-console/src/lib/console-errors.test.ts
apps/web-console/src/lib/console-errors.ts
apps/web-console/src/lib/console-metrics.test.ts
apps/web-console/src/lib/console-metrics.ts
apps/web-console/src/lib/console-openapi-sdk.ts
apps/web-console/src/lib/console-operations.test.ts
apps/web-console/src/lib/console-operations.ts
apps/web-console/src/lib/console-permissions.test.ts
apps/web-console/src/lib/console-permissions.ts
apps/web-console/src/lib/console-principal.test.ts
apps/web-console/src/lib/console-principal.ts
apps/web-console/src/lib/console-quotas.test.ts
apps/web-console/src/lib/console-quotas.ts
apps/web-console/src/lib/console-scope-enforcement.ts
apps/web-console/src/lib/console-service-accounts.test.ts
apps/web-console/src/lib/console-service-accounts.ts
apps/web-console/src/lib/console-session.test.ts
apps/web-console/src/lib/console-session.ts
apps/web-console/src/lib/console-wizards.ts
apps/web-console/src/lib/console-workspace-docs.test.ts
apps/web-console/src/lib/console-workspace-docs.ts
apps/web-console/src/lib/destructive-ops.test.ts
apps/web-console/src/lib/destructive-ops.ts
apps/web-console/src/lib/editor-ux.test.ts
apps/web-console/src/lib/editor-ux.ts
apps/web-console/src/lib/flows/monaco-environment.ts
apps/web-console/src/lib/flows/semantic-markers.ts
apps/web-console/src/lib/flows/semantic-validation-core.ts
apps/web-console/src/lib/flows/semantic-worker.ts
apps/web-console/src/lib/flows/validation-errors.test.ts
apps/web-console/src/lib/flows/validation-errors.ts
apps/web-console/src/lib/flows/view-sync.ts
apps/web-console/src/lib/flows/yaml-round-trip.ts
apps/web-console/src/lib/flows/yaml-serialiser.ts
apps/web-console/src/lib/format.test.ts
apps/web-console/src/lib/format.ts
apps/web-console/src/lib/hooks/use-capability-gate.test.ts
apps/web-console/src/lib/hooks/use-capability-gate.ts
apps/web-console/src/lib/hooks/use-flow-execution.test.tsx
apps/web-console/src/lib/hooks/use-flow-execution.ts
apps/web-console/src/lib/hooks/use-reconnect-state-sync.tenant-isolation.test.ts
apps/web-console/src/lib/hooks/use-reconnect-state-sync.test.ts
apps/web-console/src/lib/hooks/use-reconnect-state-sync.ts
apps/web-console/src/lib/http.ts
apps/web-console/src/lib/invitations.ts
apps/web-console/src/lib/mcp/mcp-api.test.ts
apps/web-console/src/lib/mcp/mcp-api.ts
apps/web-console/src/lib/mcp/mcp-connect-snippets.test.ts
apps/web-console/src/lib/mcp/mcp-connect-snippets.ts
apps/web-console/src/lib/mcp/mcp-server-detail.test.ts
apps/web-console/src/lib/mcp/mcp-server-detail.ts
apps/web-console/src/lib/reconcile-operations.runtime.d.mts
apps/web-console/src/lib/reconcile-operations.runtime.mjs
apps/web-console/src/lib/reconcile-operations.ts
apps/web-console/src/lib/snippets/snippet-catalog.test.ts
apps/web-console/src/lib/snippets/snippet-catalog.ts
apps/web-console/src/lib/snippets/snippet-generator.test.ts
apps/web-console/src/lib/snippets/snippet-generator.ts
apps/web-console/src/lib/snippets/snippet-types.ts
apps/web-console/src/lib/structural-write-access.test.ts
apps/web-console/src/lib/structural-write-access.ts
apps/web-console/src/lib/utils.ts
apps/web-console/src/lib/workspace-secrets-access.test.ts
apps/web-console/src/lib/workspace-secrets-access.ts
apps/web-console/src/main.tsx
apps/web-console/src/no-hardcoded-light-mode-colors.test.ts
apps/web-console/src/pages/ConsoleApiReferencePage.test.tsx
apps/web-console/src/pages/ConsoleApiReferencePage.tsx
apps/web-console/src/pages/ConsoleAuthConfigPage.test.tsx
apps/web-console/src/pages/ConsoleAuthConfigPage.tsx
apps/web-console/src/pages/ConsoleAuthPage.test.tsx
apps/web-console/src/pages/ConsoleAuthPage.tsx
apps/web-console/src/pages/ConsoleBackupScopePage.tsx
apps/web-console/src/pages/ConsoleCapabilityCatalogPage.test.tsx
apps/web-console/src/pages/ConsoleCapabilityCatalogPage.tsx
apps/web-console/src/pages/ConsoleDocsPage.tsx
apps/web-console/src/pages/ConsoleEventsDataPage.test.tsx
apps/web-console/src/pages/ConsoleEventsDataPage.tsx
apps/web-console/src/pages/ConsoleFlowDesignerPage.test.tsx
apps/web-console/src/pages/ConsoleFlowDesignerPage.tsx
apps/web-console/src/pages/ConsoleFlowHistoryPage.test.tsx
apps/web-console/src/pages/ConsoleFlowHistoryPage.tsx
apps/web-console/src/pages/ConsoleFlowRunPage.test.tsx
apps/web-console/src/pages/ConsoleFlowRunPage.tsx
apps/web-console/src/pages/ConsoleFlowsPage.test.tsx
apps/web-console/src/pages/ConsoleFlowsPage.tsx
apps/web-console/src/pages/ConsoleFunctionRegistryPage.test.tsx
apps/web-console/src/pages/ConsoleFunctionRegistryPage.tsx
apps/web-console/src/pages/ConsoleFunctionsDataPage.test.tsx
apps/web-console/src/pages/ConsoleFunctionsDataPage.tsx
apps/web-console/src/pages/ConsoleFunctionsPage.test.tsx
apps/web-console/src/pages/ConsoleFunctionsPage.tsx
apps/web-console/src/pages/ConsoleIamAccessPage.test.tsx
apps/web-console/src/pages/ConsoleIamAccessPage.tsx
apps/web-console/src/pages/ConsoleKafkaPage.test.tsx
apps/web-console/src/pages/ConsoleKafkaPage.tsx
apps/web-console/src/pages/ConsoleMcpServerDetailPage.test.tsx
apps/web-console/src/pages/ConsoleMcpServerDetailPage.tsx
apps/web-console/src/pages/ConsoleMembersPage.test.tsx
apps/web-console/src/pages/ConsoleMembersPage.tsx
apps/web-console/src/pages/ConsoleMongoDataPage.test.tsx
apps/web-console/src/pages/ConsoleMongoDataPage.tsx
apps/web-console/src/pages/ConsoleMongoPage.test.tsx
apps/web-console/src/pages/ConsoleMongoPage.tsx
apps/web-console/src/pages/ConsoleObservabilityPage.test.tsx
apps/web-console/src/pages/ConsoleObservabilityPage.tsx
apps/web-console/src/pages/ConsoleOperationDetailPage.test.tsx
apps/web-console/src/pages/ConsoleOperationDetailPage.tsx
apps/web-console/src/pages/ConsoleOperationsPage.test.tsx
apps/web-console/src/pages/ConsoleOperationsPage.tsx
apps/web-console/src/pages/ConsoleOverviewPage.test.tsx
apps/web-console/src/pages/ConsoleOverviewPage.tsx
apps/web-console/src/pages/ConsolePlanCatalogPage.test.tsx
apps/web-console/src/pages/ConsolePlanCatalogPage.tsx
apps/web-console/src/pages/ConsolePlanCreatePage.test.tsx
apps/web-console/src/pages/ConsolePlanCreatePage.tsx
apps/web-console/src/pages/ConsolePlanDetailPage.test.tsx
apps/web-console/src/pages/ConsolePlanDetailPage.tsx
apps/web-console/src/pages/ConsolePostgresDataPage.test.tsx
apps/web-console/src/pages/ConsolePostgresDataPage.tsx
apps/web-console/src/pages/ConsolePostgresPage.test.tsx
apps/web-console/src/pages/ConsolePostgresPage.tsx
apps/web-console/src/pages/ConsolePrivilegeDomainAuditPage.test.tsx
apps/web-console/src/pages/ConsolePrivilegeDomainAuditPage.tsx
apps/web-console/src/pages/ConsolePrivilegeDomainPage.test.tsx
apps/web-console/src/pages/ConsolePrivilegeDomainPage.tsx
apps/web-console/src/pages/ConsoleProfilePage.test.tsx
apps/web-console/src/pages/ConsoleProfilePage.tsx
apps/web-console/src/pages/ConsoleQuotasPage.test.tsx
apps/web-console/src/pages/ConsoleQuotasPage.tsx
apps/web-console/src/pages/ConsoleRealtimeChangesPage.test.tsx
apps/web-console/src/pages/ConsoleRealtimeChangesPage.tsx
apps/web-console/src/pages/ConsoleRealtimePage.test.tsx
apps/web-console/src/pages/ConsoleRealtimePage.tsx
apps/web-console/src/pages/ConsoleRuntimePage.test.tsx
apps/web-console/src/pages/ConsoleRuntimePage.tsx
apps/web-console/src/pages/ConsoleScopeEnforcementPage.test.tsx
apps/web-console/src/pages/ConsoleScopeEnforcementPage.tsx
apps/web-console/src/pages/ConsoleSecretRotationPage.test.tsx
apps/web-console/src/pages/ConsoleSecretRotationPage.tsx
apps/web-console/src/pages/ConsoleSecretsPage.test.tsx
apps/web-console/src/pages/ConsoleSecretsPage.tsx
apps/web-console/src/pages/ConsoleServiceAccountsPage.test.tsx
apps/web-console/src/pages/ConsoleServiceAccountsPage.tsx
apps/web-console/src/pages/ConsoleSettingsPage.test.tsx
apps/web-console/src/pages/ConsoleSettingsPage.tsx
apps/web-console/src/pages/ConsoleStoragePage.test.tsx
apps/web-console/src/pages/ConsoleStoragePage.tsx
apps/web-console/src/pages/ConsoleTenantAllocationSummaryPage.test.tsx
apps/web-console/src/pages/ConsoleTenantAllocationSummaryPage.tsx
apps/web-console/src/pages/ConsoleTenantConfigExportPage.tsx
apps/web-console/src/pages/ConsoleTenantConfigPreflightPage.tsx
apps/web-console/src/pages/ConsoleTenantConfigReprovisionPage.tsx
apps/web-console/src/pages/ConsoleTenantPlanOverviewPage.test.tsx
apps/web-console/src/pages/ConsoleTenantPlanOverviewPage.tsx
apps/web-console/src/pages/ConsoleTenantPlanPage.test.tsx
apps/web-console/src/pages/ConsoleTenantPlanPage.tsx
apps/web-console/src/pages/ConsoleTenantsPage.test.tsx
apps/web-console/src/pages/ConsoleTenantsPage.tsx
apps/web-console/src/pages/ConsoleWorkspaceDashboardPage.test.tsx
apps/web-console/src/pages/ConsoleWorkspaceDashboardPage.tsx
apps/web-console/src/pages/ConsoleWorkspaceDatabasePage.test.tsx
apps/web-console/src/pages/ConsoleWorkspaceDatabasePage.tsx
apps/web-console/src/pages/ConsoleWorkspaceSecretsPage.test.tsx
apps/web-console/src/pages/ConsoleWorkspaceSecretsPage.tsx
apps/web-console/src/pages/ConsoleWorkspacesPage.test.tsx
apps/web-console/src/pages/ConsoleWorkspacesPage.tsx
apps/web-console/src/pages/InvitationAcceptancePage.test.tsx
apps/web-console/src/pages/InvitationAcceptancePage.tsx
apps/web-console/src/pages/LoginPage.test.tsx
apps/web-console/src/pages/LoginPage.tsx
apps/web-console/src/pages/NotFoundPage.test.tsx
apps/web-console/src/pages/NotFoundPage.tsx
apps/web-console/src/pages/PasswordRecoveryPage.test.tsx
apps/web-console/src/pages/PasswordRecoveryPage.tsx
apps/web-console/src/pages/PendingActivationPage.test.tsx
apps/web-console/src/pages/PendingActivationPage.tsx
apps/web-console/src/pages/SignupPage.test.tsx
apps/web-console/src/pages/SignupPage.tsx
apps/web-console/src/pages/WelcomePage.test.tsx
apps/web-console/src/pages/WelcomePage.tsx
apps/web-console/src/pages/admin/BackupStatusPage.tsx
apps/web-console/src/pages/form-control-legibility.test.tsx
apps/web-console/src/pages/tenant/BackupSummaryPage.tsx
apps/web-console/src/router.auth-layout-wiring.test.tsx
apps/web-console/src/router.lazy-route-guard.test.tsx
apps/web-console/src/router.runtime.test.ts
apps/web-console/src/router.test.tsx
apps/web-console/src/router.tsx
apps/web-console/src/services/authConfigApi.test.ts
apps/web-console/src/services/authConfigApi.ts
apps/web-console/src/services/backupOperationsApi.ts
apps/web-console/src/services/backupStatusApi.ts
apps/web-console/src/services/dataExportImportApi.ts
apps/web-console/src/services/eventsApi.test.ts
apps/web-console/src/services/eventsApi.ts
apps/web-console/src/services/flowsApi.test.ts
apps/web-console/src/services/flowsApi.ts
apps/web-console/src/services/flowsMonitoringApi.test.ts
apps/web-console/src/services/flowsMonitoringApi.ts
apps/web-console/src/services/functionsApi.test.ts
apps/web-console/src/services/functionsApi.ts
apps/web-console/src/services/knativeRuntimeApi.ts
apps/web-console/src/services/mongoApi.import.test.ts
apps/web-console/src/services/mongoApi.test.ts
apps/web-console/src/services/mongoApi.ts
apps/web-console/src/services/planManagementApi.ts
apps/web-console/src/services/postgresApi.test.ts
apps/web-console/src/services/postgresApi.ts
apps/web-console/src/services/privilege-domain-api.ts
apps/web-console/src/services/realtimeApi.test.ts
apps/web-console/src/services/realtimeApi.ts
apps/web-console/src/services/secretsApi.test.ts
apps/web-console/src/services/secretsApi.ts
apps/web-console/src/services/taskTypeRegistryApi.ts
apps/web-console/src/styles/brand-tokens.test.ts
apps/web-console/src/styles/globals.css
apps/web-console/src/styles/globals.test.ts
apps/web-console/src/test/fixtures/permissions.ts
apps/web-console/src/test/fixtures/quotas.ts
apps/web-console/src/test/fixtures/resources.ts
apps/web-console/src/test/fixtures/snippets.ts
apps/web-console/src/test/fixtures/tenants.ts
apps/web-console/src/test/setup.ts
apps/web-console/src/types/flow-definition-validator.d.ts
apps/web-console/src/types/flows.ts
apps/web-console/src/vite-env.d.ts
apps/web-console/static-server.mjs
apps/web-console/tailwind.config.ts
apps/web-console/tsconfig.app.json
apps/web-console/tsconfig.json
apps/web-console/tsconfig.node.json
apps/web-console/vite.config.ts
apps/workflow-worker/.gitignore
apps/workflow-worker/Dockerfile
apps/workflow-worker/README.md
apps/workflow-worker/package.json
apps/workflow-worker/scripts/copy-activity-catalog.mjs
apps/workflow-worker/src/activities/catalog-names.mjs
apps/workflow-worker/src/activities/catalog.mjs
apps/workflow-worker/src/activities/db-query.mjs
apps/workflow-worker/src/activities/email-send.mjs
apps/workflow-worker/src/activities/errors.mjs
apps/workflow-worker/src/activities/events-publish.mjs
apps/workflow-worker/src/activities/execution-token.mjs
apps/workflow-worker/src/activities/functions-invoke.mjs
apps/workflow-worker/src/activities/http-request.mjs
apps/workflow-worker/src/activities/index.mjs
apps/workflow-worker/src/activities/index.ts
apps/workflow-worker/src/activities/limits.mjs
apps/workflow-worker/src/activities/llm-complete.mjs
apps/workflow-worker/src/activities/registry.mjs
apps/workflow-worker/src/activities/ssrf.mjs
apps/workflow-worker/src/activities/storage-get.mjs
apps/workflow-worker/src/activities/storage-put.mjs
apps/workflow-worker/src/activities/workspace-binding.mjs
apps/workflow-worker/src/shared/mapping.ts
apps/workflow-worker/src/shared/naming.ts
apps/workflow-worker/src/shared/types.ts
apps/workflow-worker/src/worker-deps.mjs
apps/workflow-worker/src/worker.ts
apps/workflow-worker/src/workflows/DslInterpreterWorkflow.ts
apps/workflow-worker/src/workflows/index.ts
apps/workflow-worker/tsconfig.json
delivery-adapter/GAP-001/FILE-SHA256SUMS
delivery-adapter/GAP-001/README.md
delivery-adapter/GAP-001/hermes-workflows-suite/adapters/common/lib.sh
delivery-adapter/GAP-001/hermes-workflows-suite/adapters/falcone/adapter.env.example
delivery-adapter/GAP-001/hermes-workflows-suite/adapters/falcone/backup-evidence.sh
delivery-adapter/GAP-001/hermes-workflows-suite/adapters/falcone/deploy-branch.sh
delivery-adapter/GAP-001/hermes-workflows-suite/adapters/falcone/lib-migration-waiver.sh
delivery-adapter/GAP-001/hermes-workflows-suite/adapters/falcone/preflight.sh
delivery-adapter/GAP-001/hermes-workflows-suite/adapters/falcone/validate-backup-evidence.sh
delivery-adapter/GAP-001/test-fixtures/falcone/staging-backup-evidence-contract.json
delivery-adapter/GAP-001/tests/run-offline-tests.sh
delivery-adapter/GAP-001/tests/test-falcone-backup-evidence.sh
delivery-adapter/GAP-001/tests/test-falcone-upgrade-gates.sh
deploy/OPENSHIFT-HARBOR-REVIEW.md
deploy/apisix/routes/scheduling.yaml
deploy/apisix/routes/webhooks.yaml
deploy/gateway-config/base/gateway.yaml
deploy/gateway-config/base/public-api-routing.yaml
deploy/gateway-config/openapi-fragments/mongo-capture.openapi.json
deploy/gateway-config/openapi-fragments/scope-enforcement.yaml
deploy/gateway-config/openapi-fragments/workspace-docs.openapi.json
deploy/gateway-config/openapi-fragments/workspace-openapi-sdk.openapi.json
deploy/gateway-config/plugins/capability-enforcement.lua
deploy/gateway-config/plugins/credential-rotation-header.yaml
deploy/gateway-config/plugins/scope-enforcement.lua
deploy/gateway-config/public-route-catalog.json
deploy/gateway-config/routes/backup-admin-routes.yaml
deploy/gateway-config/routes/backup-audit-routes.yaml
deploy/gateway-config/routes/backup-operations-routes.yaml
deploy/gateway-config/routes/backup-status-routes.yaml
deploy/gateway-config/routes/capability-gated-routes.yaml
deploy/gateway-config/routes/mcp-routes.yaml
deploy/gateway-config/routes/plan-management-routes.yaml
deploy/gateway-config/routes/platform-admin-routes.yaml
deploy/gateway-config/routes/workspace-capability-catalog.yaml
deploy/gateway-config/tests/capability-enforcement.test.mjs
deploy/gateway-config/tests/plugins/scope-enforcement-domain_spec.lua
deploy/gateway-config/tests/plugins/scope-enforcement-function-subdomain.spec.lua
deploy/gateway-config/tests/plugins/scope-enforcement-plan-rate-limit.spec.lua
deploy/k8s/encryption-config.yaml
deploy/keycloak-config/scopes/backup-audit-scopes.yaml
deploy/keycloak-config/scopes/backup-operations-scopes.yaml
deploy/keycloak-config/scopes/backup-scopes.yaml
deploy/keycloak-config/scopes/backup-status-scopes.yaml
deploy/kind/README.md
deploy/kind/apisix/apisix.yaml
deploy/kind/apply-apisix-routes.sh
deploy/kind/executor-demo.yaml
deploy/kind/knative/kourier.yaml
deploy/kind/knative/serving-core.yaml
deploy/kind/knative/serving-crds.yaml
deploy/kind/lan-forward.sh
deploy/kind/svc-stub/Dockerfile
deploy/kind/svc-stub/server.mjs
deploy/kind/ui-verify-functions.mjs
deploy/kind/ui-verify-kafka.mjs
deploy/kind/ui-verify-members.mjs
deploy/kind/ui-verify-mongo.mjs
deploy/kind/ui-verify-observability.mjs
deploy/kind/ui-verify-operations.mjs
deploy/kind/ui-verify-pages.mjs
deploy/kind/ui-verify-plans-quotas.mjs
deploy/kind/ui-verify-postgres.mjs
deploy/kind/ui-verify-serviceaccounts.mjs
deploy/kind/ui-verify-storage.mjs
deploy/kind/ui-verify.mjs
deploy/kind/web-console/Dockerfile
deploy/kind/web-console/nginx.conf
docs-site/.vitepress/config.mts
docs-site/api/control-plane.md
docs-site/api/gateway.md
docs-site/api/mongodb.md
docs-site/api/postgresql.md
docs-site/api/realtime.md
docs-site/architecture/adrs.md
docs-site/architecture/deployment.md
docs-site/architecture/domain-model.md
docs-site/architecture/ferretdb.md
docs-site/architecture/flows-runbook.md
docs-site/architecture/flows.md
docs-site/architecture/mcp-runbook.md
docs-site/architecture/mcp.md
docs-site/architecture/overview.md
docs-site/architecture/seaweedfs.md
docs-site/architecture/security.md
docs-site/architecture/services.md
docs-site/architecture/workflow-dsl-reference.md
docs-site/contributing/index.md
docs-site/guide/developer-end-to-end.md
docs-site/guide/examples.md
docs-site/guide/flows.md
docs-site/guide/installation.md
docs-site/guide/mcp.md
docs-site/guide/quickstart.md
docs-site/guide/roadmap.md
docs-site/guide/third-party-licenses.md
docs-site/guide/what-is-falcone.md
docs-site/index.md
docs-site/operations/backup-restore.md
docs-site/operations/environment-variables.md
docs-site/operations/helm-configuration.md
docs-site/operations/kubernetes-install.md
docs-site/operations/observability.md
docs-site/operations/openshift-airgapped-harbor.md
docs-site/operations/openshift-install.md
docs-site/operations/secret-management.md
docs-site/operations/webhook-signing-key-lifecycle.md
docs-site/package.json
docs-site/personas/developer.md
docs-site/personas/non-expert.md
docs-site/personas/operator.md
docs-site/public/favicon.svg
docs-site/public/img/icon-180.png
docs-site/public/img/icon-192.png
docs-site/public/img/icon-32.png
docs-site/public/img/icon-512.png
docs-site/public/img/logo-wide.png
docs-site/public/logo.svg
docs-site/public/screens/01-login.png
docs-site/public/screens/02-after-login.png
docs-site/public/screens/03-tenants.png
docs-site/public/screens/04-context.png
docs-site/public/screens/05-database.png
docs-site/public/screens/06-functions.png
docs-site/public/screens/07-iam.png
docs-site/public/screens/08-members.png
docs-site/public/screens/09-members-after-create.png
docs-site/public/screens/10-plans.png
docs-site/public/screens/11-plan-detail.png
docs-site/public/screens/12-quotas.png
docs-site/public/screens/13-observability.png
docs-site/public/screens/14-service-accounts.png
docs-site/public/screens/15-sa-credential.png
docs-site/public/screens/16-storage.png
docs-site/public/screens/17-storage-objects.png
docs-site/public/screens/18-mongo.png
docs-site/public/screens/19-mongo-documents.png
docs-site/public/screens/20-postgres.png
docs-site/public/screens/21-postgres-table.png
docs-site/public/screens/22-kafka.png
docs-site/public/screens/23-kafka-topic.png
docs-site/public/screens/24-operations.png
docs-site/public/screens/25-operation-detail.png
docs-site/public/screens/26-functions.png
docs-site/public/screens/27-functions-invoke.png
docs/installation/all-core-platform-services.md
docs/installation/function-invocation-isolation.md
docs/installation/managed-knative-proposed.md
docs/installation/openshift-airgapped-harbor.md
docs/reference/architecture/audit-chain-integrity.md
docs/reference/architecture/byok-provider-secret-confinement.md
docs/reference/architecture/console-account-status-views.md
docs/reference/architecture/console-audit-export-feedback.md
docs/reference/architecture/console-auth-config.md
docs/reference/architecture/console-auth-iam-permission-gate.md
docs/reference/architecture/console-capability-gates.md
docs/reference/architecture/console-create-form-validation.md
docs/reference/architecture/console-create-tenant-plan-assignment.md
docs/reference/architecture/console-design-system-primitives.md
docs/reference/architecture/console-destructive-confirmation.md
docs/reference/architecture/console-effective-entitlements-mapping.md
docs/reference/architecture/console-external-applications.md
docs/reference/architecture/console-form-control-theming.md
docs/reference/architecture/console-iam-access-management.md
docs/reference/architecture/console-language-policy.md
docs/reference/architecture/console-login-error-classification.md
docs/reference/architecture/console-login-password-validation.md
docs/reference/architecture/console-operations-polling.md
docs/reference/architecture/console-password-recovery-route.md
docs/reference/architecture/console-permission-aware-tenant-roles.md
docs/reference/architecture/console-plan-lifecycle-removal.md
docs/reference/architecture/console-plan-limit-edit-feedback.md
docs/reference/architecture/console-quota-breach-visibility.md
docs/reference/architecture/console-quotas-adjustment.md
docs/reference/architecture/console-router-error-handling.md
docs/reference/architecture/console-self-tenant-context.md
docs/reference/architecture/console-session-invalidation.md
docs/reference/architecture/console-signup-policy.md
docs/reference/architecture/console-superadmin-accessibility-baseline.md
docs/reference/architecture/console-tenant-inventory.md
docs/reference/architecture/console-tenant-workspace-context.md
docs/reference/architecture/console-wayfinding-responsive-shell.md
docs/reference/architecture/console-wizard-permission-gates.md
docs/reference/architecture/console-workspace-route-context.md
docs/reference/architecture/data-export-import-clone.md
docs/reference/architecture/events-console-workspace-routes.md
docs/reference/architecture/events-kafka-metadata-recovery.md
docs/reference/architecture/flow-audit-outbox.md
docs/reference/architecture/flow-console-navigation.md
docs/reference/architecture/flow-schedule-management.md
docs/reference/architecture/function-delete-lifecycle.md
docs/reference/architecture/function-rollback-history.md
docs/reference/architecture/functions-console-ia-design.md
docs/reference/architecture/functions-data-console-contract.md
docs/reference/architecture/functions-page-ux-ui.md
docs/reference/architecture/gateway-authentication-and-passthrough.md
docs/reference/architecture/iam-create-user-contract-fields.md
docs/reference/architecture/knative-runtime-status.md
docs/reference/architecture/mcp-console-route-mapping.md
docs/reference/architecture/observability-audit-record-filters.md
docs/reference/architecture/observability-metrics-time-range.md
docs/reference/architecture/public-api-surface.md
docs/reference/architecture/realm-brute-force-protection.md
docs/reference/architecture/service-account-credential-lifecycle.md
docs/reference/architecture/storage-capacity-quotas.md
docs/reference/architecture/storage-object-io.md
docs/reference/architecture/structural-write-role-gates.md
docs/reference/architecture/web-console-static-asset-delivery.md
docs/reference/architecture/workspace-consumption-route-parity.md
docs/reference/architecture/workspace-id-claim-rollout.md
docs/reference/architecture/workspace-realtime-console.md
docs/reference/architecture/workspace-secrets-console.md
docs/reference/architecture/workspace-sub-quota-allocation-summary.md
docs/reference/postgresql/tenant-isolation-baseline.sql
docs/track-f/DECISIONS.md
docs/track-f/FALCONE_GAP_ANALYSIS_FOR_LLM_CODE_WIKI.md
docs/track-f/delivery-plan.md
docs/track-f/falcone-gap-analysis.md
docs/track-f/falcone-track-getting-started.md
docs/track-f/production-readiness.md
docs/track-f/prompts/f0-verification.md
docs/track-f/prompts/w1-fal-001-spec.md
docs/track-f/prompts/w1-fal-012-spec.md
docs/track-f/remediation-order.md
docs/track-f/triage.md
falcone-loop-state/CAPABILITIES.md
falcone-loop-state/COVERAGE.md
falcone-loop-state/FINDINGS.md
falcone-loop-state/RUNLOG.md
falcone-loop-state/TEST-PLAN.md
internal-contracts/secrets/secret-audit-event-v1.yaml
internal-contracts/secrets/secret-inventory-v1.yaml
internal-contracts/secrets/secret-metadata-v1.yaml
logo-original.png
logo.svg
openspec/changes/add-759-console-members-invite-wizard/design.md
openspec/changes/add-759-console-members-invite-wizard/proposal.md
openspec/changes/add-759-console-members-invite-wizard/specs/iam/spec.md
openspec/changes/add-759-console-members-invite-wizard/specs/web-console/spec.md
openspec/changes/add-759-console-members-invite-wizard/tasks.md
openspec/changes/add-763-superadmin-iam-access-management/proposal.md
openspec/changes/add-763-superadmin-iam-access-management/specs/web-console/spec.md
openspec/changes/add-763-superadmin-iam-access-management/tasks.md
openspec/changes/add-769-plan-limits-editor/proposal.md
openspec/changes/add-769-plan-limits-editor/specs/web-console/spec.md
openspec/changes/add-769-plan-limits-editor/tasks.md
openspec/changes/add-922-openshift-build-from-source/design.md
openspec/changes/add-922-openshift-build-from-source/proposal.md
openspec/changes/add-922-openshift-build-from-source/specs/deployment-packaging/spec.md
openspec/changes/add-922-openshift-build-from-source/tasks.md
openspec/changes/add-929-openshift-private-base-images/design.md
openspec/changes/add-929-openshift-private-base-images/proposal.md
openspec/changes/add-929-openshift-private-base-images/specs/deployment-packaging/spec.md
openspec/changes/add-929-openshift-private-base-images/tasks.md
openspec/changes/add-console-plans-design-system/proposal.md
openspec/changes/add-console-plans-design-system/specs/web-console/spec.md
openspec/changes/add-console-plans-design-system/tasks.md
openspec/changes/add-managed-knative-serving/.openspec.yaml
openspec/changes/add-managed-knative-serving/design.md
openspec/changes/add-managed-knative-serving/proposal.md
openspec/changes/add-managed-knative-serving/scenario-matrix.md
openspec/changes/add-managed-knative-serving/specs/deployment/spec.md
openspec/changes/add-managed-knative-serving/specs/functions/spec.md
openspec/changes/add-managed-knative-serving/specs/mcp/spec.md
openspec/changes/add-managed-knative-serving/tasks.md
openspec/changes/add-superadmin-a11y-baseline/proposal.md
openspec/changes/add-superadmin-a11y-baseline/specs/web-console/spec.md
openspec/changes/add-superadmin-a11y-baseline/tasks.md
openspec/changes/complete-social-idp-management-console/design.md
openspec/changes/complete-social-idp-management-console/proposal.md
openspec/changes/complete-social-idp-management-console/specs/tenant-auth-config/spec.md
openspec/changes/complete-social-idp-management-console/tasks.md
openspec/changes/fix-1002-storage-get-canonical-route/proposal.md
openspec/changes/fix-1002-storage-get-canonical-route/specs/flows-activities/spec.md
openspec/changes/fix-1002-storage-get-canonical-route/tasks.md
openspec/changes/fix-1008-model-driven-workspace-authz/proposal.md
openspec/changes/fix-1008-model-driven-workspace-authz/specs/workspace-authorization/spec.md
openspec/changes/fix-1008-model-driven-workspace-authz/tasks.md
openspec/changes/fix-1009-events-publish-phantom-payload/proposal.md
openspec/changes/fix-1009-events-publish-phantom-payload/specs/events/spec.md
openspec/changes/fix-1009-events-publish-phantom-payload/tasks.md
openspec/changes/fix-1011-apikey-scope-ceiling/proposal.md
openspec/changes/fix-1011-apikey-scope-ceiling/tasks.md
openspec/changes/fix-1012-postgres-bearer-executor-route/proposal.md
openspec/changes/fix-1012-postgres-bearer-executor-route/tasks.md
openspec/changes/fix-1013-executor-5xx-code-redaction/proposal.md
openspec/changes/fix-1013-executor-5xx-code-redaction/tasks.md
openspec/changes/fix-1025-ci-integration-e2e-suites/proposal.md
openspec/changes/fix-1025-ci-integration-e2e-suites/specs/continuous-integration/spec.md
openspec/changes/fix-1025-ci-integration-e2e-suites/tasks.md
openspec/changes/fix-1026-release-images-tag-push-sha-tags/proposal.md
openspec/changes/fix-1026-release-images-tag-push-sha-tags/specs/deployment-packaging/spec.md
openspec/changes/fix-1026-release-images-tag-push-sha-tags/tasks.md
openspec/changes/fix-1053-executor-env-upgrade-path/proposal.md
openspec/changes/fix-1053-executor-env-upgrade-path/specs/deployment-packaging/spec.md
openspec/changes/fix-1053-executor-env-upgrade-path/tasks.md
openspec/changes/fix-1118-redact-flow-stream-apikey-logs/proposal.md
openspec/changes/fix-1118-redact-flow-stream-apikey-logs/specs/flow-stream-log-hygiene/spec.md
openspec/changes/fix-1118-redact-flow-stream-apikey-logs/tasks.md
openspec/changes/fix-774-tenant-plan-allocation-ux/proposal.md
openspec/changes/fix-774-tenant-plan-allocation-ux/specs/quotas-plans/spec.md
openspec/changes/fix-774-tenant-plan-allocation-ux/tasks.md
openspec/changes/fix-953-tenant-realm-console-login/proposal.md
openspec/changes/fix-953-tenant-realm-console-login/specs/console-auth/spec.md
openspec/changes/fix-953-tenant-realm-console-login/tasks.md
openspec/changes/fix-962-enforce-live-quota-dimensions/proposal.md
openspec/changes/fix-962-enforce-live-quota-dimensions/specs/quotas-plans/spec.md
openspec/changes/fix-962-enforce-live-quota-dimensions/tasks.md
openspec/changes/fix-972-function-sandbox-isolation/design.md
openspec/changes/fix-972-function-sandbox-isolation/proposal.md
openspec/changes/fix-972-function-sandbox-isolation/specs/functions/spec.md
openspec/changes/fix-972-function-sandbox-isolation/tasks.md
openspec/changes/fix-975-tenant-invitation-lifecycle/proposal.md
openspec/changes/fix-975-tenant-invitation-lifecycle/specs/iam/spec.md
openspec/changes/fix-975-tenant-invitation-lifecycle/tasks.md
openspec/changes/fix-977-purge-workspace-secrets/proposal.md
openspec/changes/fix-977-purge-workspace-secrets/specs/secrets/spec.md
openspec/changes/fix-977-purge-workspace-secrets/tasks.md
openspec/changes/fix-979-workspace-iam-client-create/proposal.md
openspec/changes/fix-979-workspace-iam-client-create/specs/iam/spec.md
openspec/changes/fix-979-workspace-iam-client-create/tasks.md
openspec/changes/fix-980-mongo-bearer-executor-route/proposal.md
openspec/changes/fix-980-mongo-bearer-executor-route/specs/mongo-gateway-auth/spec.md
openspec/changes/fix-980-mongo-bearer-executor-route/tasks.md
openspec/changes/fix-984-openbao-token-renewal/proposal.md
openspec/changes/fix-984-openbao-token-renewal/specs/secrets/spec.md
openspec/changes/fix-984-openbao-token-renewal/tasks.md
openspec/changes/fix-989-schedule-temporal-reconnect/proposal.md
openspec/changes/fix-989-schedule-temporal-reconnect/specs/flows-schedule-management/spec.md
openspec/changes/fix-989-schedule-temporal-reconnect/tasks.md
openspec/changes/fix-audit-c25-webhook-signing-key-lifecycle/design.md
openspec/changes/fix-audit-c25-webhook-signing-key-lifecycle/proposal.md
openspec/changes/fix-audit-c25-webhook-signing-key-lifecycle/specs/deployment/spec.md
openspec/changes/fix-audit-c25-webhook-signing-key-lifecycle/specs/webhooks/spec.md
openspec/changes/fix-audit-c25-webhook-signing-key-lifecycle/tasks.md
openspec/changes/fix-vector-capability-unavailable/proposal.md
openspec/changes/fix-vector-capability-unavailable/specs/vector-search/spec.md
openspec/changes/fix-vector-capability-unavailable/tasks.md
openspec/changes/harden-workspace-secrets-console-ux/proposal.md
openspec/changes/harden-workspace-secrets-console-ux/specs/web-console/spec.md
openspec/changes/harden-workspace-secrets-console-ux/tasks.md
openspec/changes/make-all-services-core/design.md
openspec/changes/make-all-services-core/proposal.md
openspec/changes/make-all-services-core/specs/platform-services/spec.md
openspec/changes/make-all-services-core/tasks.md
openspec/changes/move-deployment-to-charts-repo/specs/deployment-packaging/spec.md
openspec/changes/restructure-repository-agent-material/design.md
openspec/changes/restructure-repository-agent-material/inventory.md
openspec/changes/restructure-repository-agent-material/proposal.md
openspec/changes/restructure-repository-agent-material/tasks.md
openspec/changes/restructure-service-code-layout/design.md
openspec/changes/restructure-service-code-layout/proposal.md
openspec/changes/restructure-service-code-layout/specs/repository-structure/spec.md
openspec/changes/restructure-service-code-layout/tasks.md
package.json
packages/adapters/package.json
packages/adapters/src/authorization-policy.mjs
packages/adapters/src/kafka-admin.mjs
packages/adapters/src/keycloak-admin.mjs
packages/adapters/src/mongodb-admin.mjs
packages/adapters/src/mongodb-data-api.mjs
packages/adapters/src/openwhisk-admin.mjs
packages/adapters/src/postgresql-admin.mjs
packages/adapters/src/postgresql-data-api.mjs
packages/adapters/src/postgresql-governance-admin.mjs
packages/adapters/src/postgresql-structural-admin.mjs
packages/adapters/src/provider-catalog.mjs
packages/adapters/src/seaweedfs-iam-client.mjs
packages/adapters/src/seaweedfs-s3-identities-config.mjs
packages/adapters/src/storage-access-policy.mjs
packages/adapters/src/storage-audit-ops.mjs
packages/adapters/src/storage-bucket-object-ops.mjs
packages/adapters/src/storage-capacity-quotas.mjs
packages/adapters/src/storage-error-taxonomy.mjs
packages/adapters/src/storage-event-notifications.mjs
packages/adapters/src/storage-import-export.mjs
packages/adapters/src/storage-logical-organization.mjs
packages/adapters/src/storage-multipart-presigned.mjs
packages/adapters/src/storage-programmatic-credentials.mjs
packages/adapters/src/storage-provider-profile.mjs
packages/adapters/src/storage-provider-verification.mjs
packages/adapters/src/storage-tenant-context.mjs
packages/adapters/src/storage-usage-reporting.mjs
packages/adapters/src/tenant-rls-context.mjs
packages/audit-anomaly-handler/package.json
packages/audit-anomaly-handler/src/alert-publisher.mjs
packages/audit-anomaly-handler/src/anomaly-detector.mjs
packages/audit-anomaly-handler/src/index.mjs
packages/audit-anomaly-handler/src/rules.mjs
packages/audit/package.json
packages/audit/src/authorization-context.mjs
packages/audit/src/contract-boundary.mjs
packages/audit/src/flow-lifecycle-events.mjs
packages/backup-status/package-lock.json
packages/backup-status/package.json
packages/backup-status/src/adapters/kafka.adapter.ts
packages/backup-status/src/adapters/keycloak.adapter.ts
packages/backup-status/src/adapters/mongodb.adapter.ts
packages/backup-status/src/adapters/postgresql.adapter.ts
packages/backup-status/src/adapters/registry.js
packages/backup-status/src/adapters/registry.ts
packages/backup-status/src/adapters/s3.adapter.ts
packages/backup-status/src/adapters/types.js
packages/backup-status/src/adapters/types.ts
packages/backup-status/src/api/backup-status.action.js
packages/backup-status/src/api/backup-status.action.ts
packages/backup-status/src/api/backup-status.auth.js
packages/backup-status/src/api/backup-status.auth.ts
packages/backup-status/src/api/backup-status.schema.ts
packages/backup-status/src/api/confirm-restore.action.ts
packages/backup-status/src/api/initiate-restore.action.ts
packages/backup-status/src/audit/audit-trail.fallback.ts
packages/backup-status/src/audit/audit-trail.js
packages/backup-status/src/audit/audit-trail.repository.js
packages/backup-status/src/audit/audit-trail.repository.ts
packages/backup-status/src/audit/audit-trail.ts
packages/backup-status/src/audit/audit-trail.types.js
packages/backup-status/src/audit/audit-trail.types.ts
packages/backup-status/src/collector/collector.action.ts
packages/backup-status/src/collector/collector.config.ts
packages/backup-status/src/collector/collector.types.ts
packages/backup-status/src/confirmations/confirmations.repository.js
packages/backup-status/src/confirmations/confirmations.repository.ts
packages/backup-status/src/confirmations/confirmations.service.js
packages/backup-status/src/confirmations/confirmations.service.ts
packages/backup-status/src/confirmations/confirmations.types.js
packages/backup-status/src/confirmations/confirmations.types.ts
packages/backup-status/src/confirmations/expiry-job.action.ts
packages/backup-status/src/confirmations/precheck.types.ts
packages/backup-status/src/confirmations/prechecks/active-connections.precheck.js
packages/backup-status/src/confirmations/prechecks/active-connections.precheck.ts
packages/backup-status/src/confirmations/prechecks/active-restore.precheck.js
packages/backup-status/src/confirmations/prechecks/active-restore.precheck.ts
packages/backup-status/src/confirmations/prechecks/index.js
packages/backup-status/src/confirmations/prechecks/index.ts
packages/backup-status/src/confirmations/prechecks/newer-snapshots.precheck.js
packages/backup-status/src/confirmations/prechecks/newer-snapshots.precheck.ts
packages/backup-status/src/confirmations/prechecks/operational-hours.precheck.js
packages/backup-status/src/confirmations/prechecks/operational-hours.precheck.ts
packages/backup-status/src/confirmations/prechecks/precheck.types.js
packages/backup-status/src/confirmations/prechecks/precheck.types.ts
packages/backup-status/src/confirmations/prechecks/snapshot-age.precheck.js
packages/backup-status/src/confirmations/prechecks/snapshot-age.precheck.ts
packages/backup-status/src/confirmations/prechecks/snapshot-exists.precheck.js
packages/backup-status/src/confirmations/prechecks/snapshot-exists.precheck.ts
packages/backup-status/src/confirmations/risk-calculator.js
packages/backup-status/src/confirmations/risk-calculator.ts
packages/backup-status/src/confirmations/second-factor/otp-verifier.js
packages/backup-status/src/confirmations/second-factor/otp-verifier.ts
packages/backup-status/src/confirmations/second-factor/second-actor-verifier.js
packages/backup-status/src/confirmations/second-factor/second-actor-verifier.ts
packages/backup-status/src/confirmations/tenant-name-resolver.ts
packages/backup-status/src/db/migrations/001_backup_status_snapshots.sql
packages/backup-status/src/db/migrations/002_backup_operations.sql
packages/backup-status/src/db/migrations/003_backup_audit_events.sql
packages/backup-status/src/db/migrations/004_restore_confirmations.sql
packages/backup-status/src/db/migrations/index.ts
packages/backup-status/src/db/repository.js
packages/backup-status/src/db/repository.ts
packages/backup-status/src/operations/get-operation.action.js
packages/backup-status/src/operations/get-operation.action.ts
packages/backup-status/src/operations/list-snapshots.action.ts
packages/backup-status/src/operations/operation-dispatcher.js
packages/backup-status/src/operations/operation-dispatcher.ts
packages/backup-status/src/operations/operations.repository.js
packages/backup-status/src/operations/operations.repository.ts
packages/backup-status/src/operations/operations.types.js
packages/backup-status/src/operations/operations.types.ts
packages/backup-status/src/operations/query-audit.action.ts
packages/backup-status/src/operations/restore-simulation.service.js
packages/backup-status/src/operations/restore-simulation.service.ts
packages/backup-status/src/operations/restore-simulation.types.js
packages/backup-status/src/operations/restore-simulation.types.ts
packages/backup-status/src/operations/trigger-backup.action.ts
packages/backup-status/src/operations/trigger-restore.action.ts
packages/backup-status/src/shared/audit.js
packages/backup-status/src/shared/audit.ts
packages/backup-status/src/shared/deployment-profile.ts
packages/backup-status/src/shared/network.ts
packages/backup-status/test/confirmations/risk-calculator.test.ts
packages/backup-status/test/contract/audit-event.contract.ts
packages/backup-status/test/contract/backup-operations-response.contract.test.ts
packages/backup-status/test/contract/backup-status-response.contract.ts
packages/backup-status/test/integration/backup-audit-api.test.mjs
packages/backup-status/test/integration/backup-operations-api.test.mjs
packages/backup-status/test/integration/backup-operations-api.test.ts
packages/backup-status/test/integration/backup-status-api.test.mjs
packages/backup-status/test/integration/tenant-name-resolver.keycloak.test.ts
packages/backup-status/test/unit/adapters/postgresql-actions.adapter.test.ts
packages/backup-status/test/unit/adapters/postgresql.adapter.test.ts
packages/backup-status/test/unit/api/backup-status.action.test.ts
packages/backup-status/test/unit/api/backup-status.auth.test.ts
packages/backup-status/test/unit/api/initiate-restore-resolver.integration.test.ts
packages/backup-status/test/unit/api/restore-tenant-binding.test.ts
packages/backup-status/test/unit/audit/audit-trail.fallback.test.ts
packages/backup-status/test/unit/audit/audit-trail.repository.test.ts
packages/backup-status/test/unit/audit/audit-trail.test.ts
packages/backup-status/test/unit/audit/query-audit.action.test.ts
packages/backup-status/test/unit/collector/collector.action.test.ts
packages/backup-status/test/unit/confirmations/otp-verifier.test.ts
packages/backup-status/test/unit/confirmations/tenant-name-resolver.test.ts
packages/backup-status/test/unit/confirmations/tokenhash-not-credential.test.ts
packages/backup-status/test/unit/operations/get-operation.action.test.ts
packages/backup-status/test/unit/operations/list-snapshots.action.test.ts
packages/backup-status/test/unit/operations/operation-dispatcher.test.ts
packages/backup-status/test/unit/operations/trigger-backup.action.test.ts
packages/backup-status/test/unit/operations/trigger-restore.action.test.ts
packages/backup-status/tsconfig.json
packages/backup-status/vitest.config.ts
packages/billing-export/kafka-topics.json
packages/billing-export/package.json
packages/billing-export/src/emitter.mjs
packages/billing-export/src/index.mjs
packages/billing-export/src/query-handler.mjs
packages/event-gateway/package.json
packages/event-gateway/src/contract-boundary.mjs
packages/event-gateway/src/kafka-integrations.mjs
packages/event-gateway/src/runtime.mjs
packages/internal-contracts/package.json
packages/internal-contracts/src/async-operation-query-response.json
packages/internal-contracts/src/async-operation-state-changed.json
packages/internal-contracts/src/authorization-model.json
packages/internal-contracts/src/console-workflow-audit-policy.json
packages/internal-contracts/src/console-workflow-invocation.json
packages/internal-contracts/src/console-workflow-job-status.json
packages/internal-contracts/src/deployment-topology.json
packages/internal-contracts/src/deployment-topology.mjs
packages/internal-contracts/src/domain-model.json
packages/internal-contracts/src/failure-classified-event.json
packages/internal-contracts/src/fixtures/flows/branch-retry.json
packages/internal-contracts/src/fixtures/flows/human-approval.json
packages/internal-contracts/src/fixtures/flows/invalid/flw-e001-duplicate-id.json
packages/internal-contracts/src/fixtures/flows/invalid/flw-e002-cycle.json
packages/internal-contracts/src/fixtures/flows/invalid/flw-e003-dangling-ref.json
packages/internal-contracts/src/fixtures/flows/invalid/flw-e004-unresolved-sub-flow.json
packages/internal-contracts/src/fixtures/flows/invalid/flw-e005-bad-expression.json
packages/internal-contracts/src/fixtures/flows/invalid/flw-e006-unknown-task-type.json
packages/internal-contracts/src/fixtures/flows/invalid/flw-e007-bad-cron.json
packages/internal-contracts/src/fixtures/flows/invalid/flw-e008-bad-duration.json
packages/internal-contracts/src/fixtures/flows/invalid/flw-e009-branch-arity.json
packages/internal-contracts/src/fixtures/flows/minimal-3-node.json
packages/internal-contracts/src/fixtures/flows/parallel-fan-out.json
packages/internal-contracts/src/fixtures/flows/sub-flow-ref.json
packages/internal-contracts/src/flow-definition-mapping.json
packages/internal-contracts/src/flow-definition-schema-validator.mjs
packages/internal-contracts/src/flow-definition-validator.mjs
packages/internal-contracts/src/flow-definition.json
packages/internal-contracts/src/http-idempotency.mjs
packages/internal-contracts/src/idempotency-dedup-event.json
packages/internal-contracts/src/index.mjs
packages/internal-contracts/src/internal-service-map.json
packages/internal-contracts/src/intervention-notification-event.json
packages/internal-contracts/src/manual-intervention-required-event.json
packages/internal-contracts/src/mongo-capture-change-event.json
packages/internal-contracts/src/mongo-capture-lifecycle-event.json
packages/internal-contracts/src/observability-audit-correlation-surface.json
packages/internal-contracts/src/observability-audit-event-schema.json
packages/internal-contracts/src/observability-audit-export-surface.json
packages/internal-contracts/src/observability-audit-pipeline.json
packages/internal-contracts/src/observability-audit-query-surface.json
packages/internal-contracts/src/observability-business-metrics.json
packages/internal-contracts/src/observability-console-alerts.json
packages/internal-contracts/src/observability-dashboards.json
packages/internal-contracts/src/observability-hard-limit-enforcement.json
packages/internal-contracts/src/observability-health-checks.json
packages/internal-contracts/src/observability-metrics-stack.json
packages/internal-contracts/src/observability-quota-policies.json
packages/internal-contracts/src/observability-quota-usage-view.json
packages/internal-contracts/src/observability-threshold-alerts.json
packages/internal-contracts/src/observability-usage-consumption.json
packages/internal-contracts/src/openapi-spec-updated-event.json
packages/internal-contracts/src/operation-cancel-event.json
packages/internal-contracts/src/operation-recovery-event.json
packages/internal-contracts/src/operation-retry-event.json
packages/internal-contracts/src/operation-timeout-event.json
packages/internal-contracts/src/pg-capture-change-event.json
packages/internal-contracts/src/pg-capture-lifecycle-event.json
packages/internal-contracts/src/postgres-extension-availability.mjs
packages/internal-contracts/src/privilege-domain-assignment.schema.json
packages/internal-contracts/src/privilege-domain-denial.schema.json
packages/internal-contracts/src/public-api-taxonomy.json
packages/internal-contracts/src/public-route-catalog.json
packages/internal-contracts/src/request-log.mjs
packages/internal-contracts/src/retry-override-event.json
packages/internal-contracts/src/saga-contract.json
packages/internal-contracts/src/scope-enforcement-denial-event.json
packages/internal-contracts/src/scope-enforcement-denial-query-response.json
packages/internal-contracts/src/sdk-generation-completed-event.json
packages/internal-contracts/src/sdk-package.json
packages/internal-contracts/src/snippet-catalog-data.json
packages/internal-contracts/src/transport-security.mjs
packages/internal-contracts/src/workspace-capability-catalog-accessed-event.json
packages/internal-contracts/src/workspace-capability-catalog-response.json
packages/internal-contracts/src/workspace-doc-note.json
packages/internal-contracts/src/workspace-docs-accessed-event.json
packages/internal-contracts/src/workspace-docs-response.json
packages/internal-contracts/src/workspace-openapi-version.json
packages/mcp-server-sdk/README.md
packages/mcp-server-sdk/package.json
packages/mcp-server-sdk/python/falcone_mcp/__init__.py
packages/mcp-server-sdk/src/context.mjs
packages/mcp-server-sdk/src/context.test.mjs
packages/mcp-server-sdk/src/index.mjs
packages/mcp-server-sdk/src/server.mjs
packages/mcp-server-sdk/src/server.test.mjs
packages/mongo-cdc-bridge/Dockerfile
packages/mongo-cdc-bridge/package.json
packages/mongo-cdc-bridge/src/ChangeStreamManager.mjs
packages/mongo-cdc-bridge/src/ChangeStreamWatcher.mjs
packages/mongo-cdc-bridge/src/CollectionCatalog.mjs
packages/mongo-cdc-bridge/src/HealthServer.mjs
packages/mongo-cdc-bridge/src/KafkaChangePublisher.mjs
packages/mongo-cdc-bridge/src/MetricsCollector.mjs
packages/mongo-cdc-bridge/src/MongoCaptureConfigCache.mjs
packages/mongo-cdc-bridge/src/MongoChangeEventMapper.mjs
packages/mongo-cdc-bridge/src/ResumeTokenStore.mjs
packages/mongo-cdc-bridge/src/WalBsonDecoder.mjs
packages/mongo-cdc-bridge/src/WalReplicationClient.mjs
packages/mongo-cdc-bridge/src/index.mjs
packages/mongo-cdc-bridge/src/provisionLogicalReplication.mjs
packages/mongo-cdc-bridge/tests/integration/mongo-capture-to-kafka.integration.test.mjs
packages/mongo-cdc-bridge/tests/unit/ChangeStreamWatcher.test.mjs
packages/mongo-cdc-bridge/tests/unit/MongoCaptureConfigCache.test.mjs
packages/mongo-cdc-bridge/tests/unit/MongoChangeEventMapper.test.mjs
packages/mongo-cdc-bridge/tests/unit/ResumeTokenStore.test.mjs
packages/mongo-cdc-bridge/tests/unit/WalBsonDecoder.test.mjs
packages/mongo-cdc-bridge/tests/unit/provisionLogicalReplication.test.mjs
packages/openapi-sdk-service/.spectral.yaml
packages/openapi-sdk-service/actions/openapi-spec-regenerate.mjs
packages/openapi-sdk-service/actions/openapi-spec-serve.mjs
packages/openapi-sdk-service/actions/sdk-generate.mjs
packages/openapi-sdk-service/migrations/088-workspace-openapi-versions.sql
packages/openapi-sdk-service/migrations/088-workspace-sdk-packages.sql
packages/openapi-sdk-service/package.json
packages/openapi-sdk-service/scripts/lint-openapi.mjs
packages/openapi-sdk-service/src/capability-manifest-client.mjs
packages/openapi-sdk-service/src/capability-modules/auth.paths.json
packages/openapi-sdk-service/src/capability-modules/base-template.openapi.json
packages/openapi-sdk-service/src/capability-modules/events.paths.json
packages/openapi-sdk-service/src/capability-modules/functions.paths.json
packages/openapi-sdk-service/src/capability-modules/mongodb.paths.json
packages/openapi-sdk-service/src/capability-modules/postgresql.paths.json
packages/openapi-sdk-service/src/capability-modules/realtime.paths.json
packages/openapi-sdk-service/src/capability-modules/storage.paths.json
packages/openapi-sdk-service/src/config.mjs
packages/openapi-sdk-service/src/network.mjs
packages/openapi-sdk-service/src/sdk-builder.mjs
packages/openapi-sdk-service/src/sdk-package-repo.mjs
packages/openapi-sdk-service/src/sdk-storage.mjs
packages/openapi-sdk-service/src/spec-assembler.mjs
packages/openapi-sdk-service/src/spec-audit.mjs
packages/openapi-sdk-service/src/spec-cache.mjs
packages/openapi-sdk-service/src/spec-version-repo.mjs
packages/openapi-sdk-service/tests/capability-manifest-client.test.mjs
packages/openapi-sdk-service/tests/openapi-spec-serve.action.test.mjs
packages/openapi-sdk-service/tests/sdk-builder.test.mjs
packages/openapi-sdk-service/tests/sdk-storage.test.mjs
packages/openapi-sdk-service/tests/spec-assembler.test.mjs
packages/openapi-sdk-service/tests/spec-cache.test.mjs
packages/openapi-sdk-service/tests/spec-version-repo.test.mjs
packages/pg-cdc-bridge/package.json
packages/pg-cdc-bridge/src/CaptureConfigCache.mjs
packages/pg-cdc-bridge/src/HealthServer.mjs
packages/pg-cdc-bridge/src/KafkaChangePublisher.mjs
packages/pg-cdc-bridge/src/MetricsCollector.mjs
packages/pg-cdc-bridge/src/PgWalListener.mjs
packages/pg-cdc-bridge/src/RouteFilter.mjs
packages/pg-cdc-bridge/src/WalEventDecoder.mjs
packages/pg-cdc-bridge/src/WalListenerManager.mjs
packages/pg-cdc-bridge/src/index.mjs
packages/pg-cdc-bridge/tests/integration/cdc-topic-isolation.kafka.test.mjs
packages/pg-cdc-bridge/tests/integration/pg-capture-to-kafka.integration.test.mjs
packages/pg-cdc-bridge/tests/unit/CaptureConfigCache.test.mjs
packages/pg-cdc-bridge/tests/unit/RouteFilter.test.mjs
packages/pg-cdc-bridge/tests/unit/WalEventDecoder.test.mjs
packages/provisioning-orchestrator/package.json
packages/provisioning-orchestrator/src/actions/api-key-domain-migration.mjs
packages/provisioning-orchestrator/src/actions/async-operation-cancel.mjs
packages/provisioning-orchestrator/src/actions/async-operation-create.mjs
packages/provisioning-orchestrator/src/actions/async-operation-intervention-notify.mjs
packages/provisioning-orchestrator/src/actions/async-operation-orphan-sweep.mjs
packages/provisioning-orchestrator/src/actions/async-operation-query.mjs
packages/provisioning-orchestrator/src/actions/async-operation-retry-override.mjs
packages/provisioning-orchestrator/src/actions/async-operation-retry-semantics.mjs
packages/provisioning-orchestrator/src/actions/async-operation-retry.mjs
packages/provisioning-orchestrator/src/actions/async-operation-timeout-sweep.mjs
packages/provisioning-orchestrator/src/actions/async-operation-transition.mjs
packages/provisioning-orchestrator/src/actions/backup-scope-get.mjs
packages/provisioning-orchestrator/src/actions/caller-context.mjs
packages/provisioning-orchestrator/src/actions/capability-catalog-list.mjs
packages/provisioning-orchestrator/src/actions/credential-rotation-expiry-sweep.mjs
packages/provisioning-orchestrator/src/actions/function-privilege-denial-recorder.mjs
packages/provisioning-orchestrator/src/actions/plan-assign.mjs
packages/provisioning-orchestrator/src/actions/plan-assignment-get.mjs
packages/provisioning-orchestrator/src/actions/plan-assignment-history.mjs
packages/provisioning-orchestrator/src/actions/plan-capability-audit-query.mjs
packages/provisioning-orchestrator/src/actions/plan-capability-profile-get.mjs
packages/provisioning-orchestrator/src/actions/plan-capability-set.mjs
packages/provisioning-orchestrator/src/actions/plan-change-history-query.mjs
packages/provisioning-orchestrator/src/actions/plan-create.mjs
packages/provisioning-orchestrator/src/actions/plan-delete.mjs
packages/provisioning-orchestrator/src/actions/plan-effective-entitlements-get.mjs
packages/provisioning-orchestrator/src/actions/plan-get.mjs
packages/provisioning-orchestrator/src/actions/plan-lifecycle.mjs
packages/provisioning-orchestrator/src/actions/plan-limits-profile-get.mjs
packages/provisioning-orchestrator/src/actions/plan-limits-remove.mjs
packages/provisioning-orchestrator/src/actions/plan-limits-set.mjs
packages/provisioning-orchestrator/src/actions/plan-limits-tenant-get.mjs
packages/provisioning-orchestrator/src/actions/plan-list.mjs
packages/provisioning-orchestrator/src/actions/plan-update.mjs
packages/provisioning-orchestrator/src/actions/privilege-domain-assign.mjs
packages/provisioning-orchestrator/src/actions/privilege-domain-audit-query.mjs
packages/provisioning-orchestrator/src/actions/privilege-domain-event-recorder.mjs
packages/provisioning-orchestrator/src/actions/privilege-domain-query.mjs
packages/provisioning-orchestrator/src/actions/quota-audit-query.mjs
packages/provisioning-orchestrator/src/actions/quota-dimension-catalog-list.mjs
packages/provisioning-orchestrator/src/actions/quota-effective-limits-get.mjs
packages/provisioning-orchestrator/src/actions/quota-enforce.mjs
packages/provisioning-orchestrator/src/actions/quota-override-create.mjs
packages/provisioning-orchestrator/src/actions/quota-override-expiry-sweep.mjs
packages/provisioning-orchestrator/src/actions/quota-override-list.mjs
packages/provisioning-orchestrator/src/actions/quota-override-modify.mjs
packages/provisioning-orchestrator/src/actions/quota-override-revoke.mjs
packages/provisioning-orchestrator/src/actions/realtime/mongo-capture-disable.mjs
packages/provisioning-orchestrator/src/actions/realtime/mongo-capture-enable.mjs
packages/provisioning-orchestrator/src/actions/realtime/mongo-capture-list.mjs
packages/provisioning-orchestrator/src/actions/realtime/mongo-capture-tenant-summary.mjs
packages/provisioning-orchestrator/src/actions/realtime/parse-identity.mjs
packages/provisioning-orchestrator/src/actions/realtime/pg-capture-disable.mjs
packages/provisioning-orchestrator/src/actions/realtime/pg-capture-enable.mjs
packages/provisioning-orchestrator/src/actions/realtime/pg-capture-list.mjs
packages/provisioning-orchestrator/src/actions/realtime/pg-capture-tenant-summary.mjs
packages/provisioning-orchestrator/src/actions/realtime/realtime-channel-list.mjs
packages/provisioning-orchestrator/src/actions/realtime/realtime-subscription-crud.mjs
packages/provisioning-orchestrator/src/actions/realtime/realtime-subscription-resolver.mjs
packages/provisioning-orchestrator/src/actions/scope-enforcement-audit-query.mjs
packages/provisioning-orchestrator/src/actions/scope-enforcement-event-recorder.mjs
packages/provisioning-orchestrator/src/actions/secret-consumer-ack.mjs
packages/provisioning-orchestrator/src/actions/secret-inventory.mjs
packages/provisioning-orchestrator/src/actions/secret-path-ownership.mjs
packages/provisioning-orchestrator/src/actions/secret-rotation-consumer-status.mjs
packages/provisioning-orchestrator/src/actions/secret-rotation-expiry-sweep.mjs
packages/provisioning-orchestrator/src/actions/secret-rotation-history.mjs
packages/provisioning-orchestrator/src/actions/secret-rotation-initiate.mjs
packages/provisioning-orchestrator/src/actions/secret-rotation-propagation-timeout-sweep.mjs
packages/provisioning-orchestrator/src/actions/secret-rotation-revoke.mjs
packages/provisioning-orchestrator/src/actions/storage-credential-expiry-sweep.mjs
packages/provisioning-orchestrator/src/actions/storage-identity-runtime.mjs
packages/provisioning-orchestrator/src/actions/tenant-backup-scope-get.mjs
packages/provisioning-orchestrator/src/actions/tenant-config-export-domains.mjs
packages/provisioning-orchestrator/src/actions/tenant-config-export.mjs
packages/provisioning-orchestrator/src/actions/tenant-config-format-versions.mjs
packages/provisioning-orchestrator/src/actions/tenant-config-identifier-map.mjs
packages/provisioning-orchestrator/src/actions/tenant-config-identity.mjs
packages/provisioning-orchestrator/src/actions/tenant-config-migrate.mjs
packages/provisioning-orchestrator/src/actions/tenant-config-preflight.mjs
packages/provisioning-orchestrator/src/actions/tenant-config-reprovision.mjs
packages/provisioning-orchestrator/src/actions/tenant-config-validate.mjs
packages/provisioning-orchestrator/src/actions/tenant-consumption-snapshot-get.mjs
packages/provisioning-orchestrator/src/actions/tenant-effective-capabilities-get.mjs
packages/provisioning-orchestrator/src/actions/tenant-effective-entitlements-get.mjs
packages/provisioning-orchestrator/src/actions/tenant-purge-sweep.mjs
packages/provisioning-orchestrator/src/actions/tenant-workspace-allocation-summary-get.mjs
packages/provisioning-orchestrator/src/actions/workspace-capability-catalog.mjs
packages/provisioning-orchestrator/src/actions/workspace-consumption-get.mjs
packages/provisioning-orchestrator/src/actions/workspace-effective-limits-get.mjs
packages/provisioning-orchestrator/src/actions/workspace-sub-quota-list.mjs
packages/provisioning-orchestrator/src/actions/workspace-sub-quota-remove.mjs
packages/provisioning-orchestrator/src/actions/workspace-sub-quota-set.mjs
packages/provisioning-orchestrator/src/appliers/documentdb-identity-applier.mjs
packages/provisioning-orchestrator/src/appliers/functions-applier.mjs
packages/provisioning-orchestrator/src/appliers/iam-applier.mjs
packages/provisioning-orchestrator/src/appliers/kafka-applier.mjs
packages/provisioning-orchestrator/src/appliers/mcp-applier.mjs
packages/provisioning-orchestrator/src/appliers/mcp-applier.test.mjs
packages/provisioning-orchestrator/src/appliers/mongo-applier.mjs
packages/provisioning-orchestrator/src/appliers/postgres-applier.mjs
packages/provisioning-orchestrator/src/appliers/postgres-applier.preflight.test.mjs
packages/provisioning-orchestrator/src/appliers/region-guard.mjs
packages/provisioning-orchestrator/src/appliers/storage-applier.mjs
packages/provisioning-orchestrator/src/appliers/workflows-applier.mjs
packages/provisioning-orchestrator/src/authorization-context.mjs
packages/provisioning-orchestrator/src/collectors/functions-collector.mjs
packages/provisioning-orchestrator/src/collectors/iam-collector.mjs
packages/provisioning-orchestrator/src/collectors/kafka-collector.mjs
packages/provisioning-orchestrator/src/collectors/mongo-collector.mjs
packages/provisioning-orchestrator/src/collectors/postgres-collector.mjs
packages/provisioning-orchestrator/src/collectors/registry.mjs
packages/provisioning-orchestrator/src/collectors/s3-collector.mjs
packages/provisioning-orchestrator/src/collectors/types.mjs
packages/provisioning-orchestrator/src/commands/reconcile-buckets.mjs
packages/provisioning-orchestrator/src/config/seaweedfs-compat-matrix.json
packages/provisioning-orchestrator/src/contract-boundary.mjs
packages/provisioning-orchestrator/src/events/async-operation-events.mjs
packages/provisioning-orchestrator/src/events/backup-scope-events.mjs
packages/provisioning-orchestrator/src/events/config-export-events.mjs
packages/provisioning-orchestrator/src/events/config-preflight-events.mjs
packages/provisioning-orchestrator/src/events/config-reprovision-events.mjs
packages/provisioning-orchestrator/src/events/config-schema-events.mjs
packages/provisioning-orchestrator/src/events/function-privilege-events.mjs
packages/provisioning-orchestrator/src/events/plan-capability-events.mjs
packages/provisioning-orchestrator/src/events/plan-change-impact-events.mjs
packages/provisioning-orchestrator/src/events/plan-events.mjs
packages/provisioning-orchestrator/src/events/plan-limit-events.mjs
packages/provisioning-orchestrator/src/events/privilege-domain-events.mjs
packages/provisioning-orchestrator/src/events/quota-enforcement-events.mjs
packages/provisioning-orchestrator/src/events/quota-override-events.mjs
packages/provisioning-orchestrator/src/events/realtime/MongoCaptureLifecyclePublisher.mjs
packages/provisioning-orchestrator/src/events/realtime/PgCaptureLifecyclePublisher.mjs
packages/provisioning-orchestrator/src/events/realtime/SubscriptionLifecyclePublisher.mjs
packages/provisioning-orchestrator/src/events/scope-enforcement-events.mjs
packages/provisioning-orchestrator/src/events/workspace-sub-quota-events.mjs
packages/provisioning-orchestrator/src/http/safe-url.mjs
packages/provisioning-orchestrator/src/migrations/0020_create_realtime_channels.sql
packages/provisioning-orchestrator/src/migrations/0021_create_realtime_subscriptions.sql
packages/provisioning-orchestrator/src/migrations/0022_create_subscription_quotas.sql
packages/provisioning-orchestrator/src/migrations/0023_create_subscription_audit_log.sql
packages/provisioning-orchestrator/src/migrations/022-secret-metadata.sql
packages/provisioning-orchestrator/src/migrations/070-saga-state-tables.sql
packages/provisioning-orchestrator/src/migrations/073-async-operation-tables.sql
packages/provisioning-orchestrator/src/migrations/074-async-operation-log-entries.sql
packages/provisioning-orchestrator/src/migrations/075-idempotency-retry-tables.sql
packages/provisioning-orchestrator/src/migrations/076-timeout-cancel-recovery.sql
packages/provisioning-orchestrator/src/migrations/078-retry-semantics-intervention.sql
packages/provisioning-orchestrator/src/migrations/080-pg-capture-config.sql
packages/provisioning-orchestrator/src/migrations/081-mongo-capture-config.sql
packages/provisioning-orchestrator/src/migrations/089-api-key-rotation.sql
packages/provisioning-orchestrator/src/migrations/090-rls-rotation-tables.sql
packages/provisioning-orchestrator/src/migrations/090-storage-credential-rotation-policy.sql
packages/provisioning-orchestrator/src/migrations/090-workspace-capability-catalog.sql
packages/provisioning-orchestrator/src/migrations/091-tenant-data-residency.sql
packages/provisioning-orchestrator/src/migrations/092-secret-rotation.sql
packages/provisioning-orchestrator/src/migrations/093-scope-enforcement.sql
packages/provisioning-orchestrator/src/migrations/094-admin-data-privilege-separation.sql
packages/provisioning-orchestrator/src/migrations/095-function-deploy-exec-separation.sql
packages/provisioning-orchestrator/src/migrations/097-plan-entity-tenant-assignment.sql
packages/provisioning-orchestrator/src/migrations/098-plan-base-limits.sql
packages/provisioning-orchestrator/src/migrations/100-plan-change-impact-history.sql
packages/provisioning-orchestrator/src/migrations/103-hard-soft-quota-overrides.sql
packages/provisioning-orchestrator/src/migrations/104-plan-boolean-capabilities.sql
packages/provisioning-orchestrator/src/migrations/105-effective-limit-resolution.sql
packages/provisioning-orchestrator/src/migrations/114-backup-scope-deployment-profiles.sql
packages/provisioning-orchestrator/src/migrations/115-functional-config-export.sql
packages/provisioning-orchestrator/src/migrations/117-tenant-config-reprovision.sql
packages/provisioning-orchestrator/src/migrations/118-config-preflight.sql
packages/provisioning-orchestrator/src/migrations/119-billing-usage-records.sql
packages/provisioning-orchestrator/src/migrations/120-tenant-custom-roles.sql
packages/provisioning-orchestrator/src/migrations/121-flow-quota-dimensions.sql
packages/provisioning-orchestrator/src/migrations/122-knative-runtime-cleanup.sql
packages/provisioning-orchestrator/src/migrations/123-authorization-denial-audit.sql
packages/provisioning-orchestrator/src/migrations/124-http-idempotency.sql
packages/provisioning-orchestrator/src/models/async-operation-states.mjs
packages/provisioning-orchestrator/src/models/async-operation.mjs
packages/provisioning-orchestrator/src/models/boolean-capability.mjs
packages/provisioning-orchestrator/src/models/credential-rotation-history.mjs
packages/provisioning-orchestrator/src/models/credential-rotation-state.mjs
packages/provisioning-orchestrator/src/models/effective-entitlement-snapshot.mjs
packages/provisioning-orchestrator/src/models/effective-entitlements.mjs
packages/provisioning-orchestrator/src/models/failure-classification.mjs
packages/provisioning-orchestrator/src/models/function-privilege-assignment.mjs
packages/provisioning-orchestrator/src/models/idempotency-key-record.mjs
packages/provisioning-orchestrator/src/models/manual-intervention-flag.mjs
packages/provisioning-orchestrator/src/models/plan-assignment.mjs
packages/provisioning-orchestrator/src/models/plan-change-history-entry.mjs
packages/provisioning-orchestrator/src/models/plan.mjs
packages/provisioning-orchestrator/src/models/privilege-domain-assignment.mjs
packages/provisioning-orchestrator/src/models/quota-dimension.mjs
packages/provisioning-orchestrator/src/models/quota-enforcement.mjs
packages/provisioning-orchestrator/src/models/quota-override.mjs
packages/provisioning-orchestrator/src/models/realtime/CaptureChangeEvent.mjs
packages/provisioning-orchestrator/src/models/realtime/CaptureConfig.mjs
packages/provisioning-orchestrator/src/models/realtime/ChannelType.mjs
packages/provisioning-orchestrator/src/models/realtime/EventFilter.mjs
packages/provisioning-orchestrator/src/models/realtime/MongoCaptureConfig.mjs
packages/provisioning-orchestrator/src/models/realtime/MongoChangeEvent.mjs
packages/provisioning-orchestrator/src/models/realtime/Subscription.mjs
packages/provisioning-orchestrator/src/models/realtime/SubscriptionQuota.mjs
packages/provisioning-orchestrator/src/models/retry-attempt.mjs
packages/provisioning-orchestrator/src/models/retry-override.mjs
packages/provisioning-orchestrator/src/models/retry-semantics-profile.mjs
packages/provisioning-orchestrator/src/models/scope-enforcement-denial.mjs
packages/provisioning-orchestrator/src/models/secret-rotation-event.mjs
packages/provisioning-orchestrator/src/models/secret-version-state.mjs
packages/provisioning-orchestrator/src/models/tenant-rotation-policy.mjs
packages/provisioning-orchestrator/src/models/workspace-sub-quota.mjs
packages/provisioning-orchestrator/src/observability/plan-change-impact-metrics.mjs
packages/provisioning-orchestrator/src/preflight/analyzer-registry.mjs
packages/provisioning-orchestrator/src/preflight/analyzers/analyzer-helpers.mjs
packages/provisioning-orchestrator/src/preflight/analyzers/functions-analyzer.mjs
packages/provisioning-orchestrator/src/preflight/analyzers/iam-analyzer.mjs
packages/provisioning-orchestrator/src/preflight/analyzers/kafka-analyzer.mjs
packages/provisioning-orchestrator/src/preflight/analyzers/mongo-analyzer.mjs
packages/provisioning-orchestrator/src/preflight/analyzers/postgres-analyzer.mjs
packages/provisioning-orchestrator/src/preflight/analyzers/storage-analyzer.mjs
packages/provisioning-orchestrator/src/preflight/conflict-classifier.mjs
packages/provisioning-orchestrator/src/preflight/recommendation-engine.mjs
packages/provisioning-orchestrator/src/preflight/types.mjs
packages/provisioning-orchestrator/src/reconcilers/bucket-discovery.mjs
packages/provisioning-orchestrator/src/reconcilers/bucket-reconciler.mjs
packages/provisioning-orchestrator/src/reconcilers/compat-gate.mjs
packages/provisioning-orchestrator/src/reconcilers/gap-logger.mjs
packages/provisioning-orchestrator/src/reconcilers/s3-rest-client.mjs
packages/provisioning-orchestrator/src/repositories/async-operation-query-repo.mjs
packages/provisioning-orchestrator/src/repositories/async-operation-repo.mjs
packages/provisioning-orchestrator/src/repositories/backup-scope-repository.mjs
packages/provisioning-orchestrator/src/repositories/boolean-capability-catalog-repository.mjs
packages/provisioning-orchestrator/src/repositories/config-export-audit-repository.mjs
packages/provisioning-orchestrator/src/repositories/config-preflight-audit-repository.mjs
packages/provisioning-orchestrator/src/repositories/config-reprovision-audit-repository.mjs
packages/provisioning-orchestrator/src/repositories/config-reprovision-lock-repository.mjs
packages/provisioning-orchestrator/src/repositories/consumption-repository.mjs
packages/provisioning-orchestrator/src/repositories/credential-rotation-repo.mjs
packages/provisioning-orchestrator/src/repositories/effective-entitlements-repository.mjs
packages/provisioning-orchestrator/src/repositories/function-privilege-repository.mjs
packages/provisioning-orchestrator/src/repositories/idempotency-key-repo.mjs
packages/provisioning-orchestrator/src/repositories/manual-intervention-flag-repo.mjs
packages/provisioning-orchestrator/src/repositories/plan-assignment-repository.mjs
packages/provisioning-orchestrator/src/repositories/plan-audit-repository.mjs
packages/provisioning-orchestrator/src/repositories/plan-capability-repository.mjs
packages/provisioning-orchestrator/src/repositories/plan-change-history-repository.mjs
packages/provisioning-orchestrator/src/repositories/plan-limits-repository.mjs
packages/provisioning-orchestrator/src/repositories/plan-repository.mjs
packages/provisioning-orchestrator/src/repositories/privilege-domain-repository.mjs
packages/provisioning-orchestrator/src/repositories/quota-audit-repository.mjs
packages/provisioning-orchestrator/src/repositories/quota-dimension-catalog-repository.mjs
packages/provisioning-orchestrator/src/repositories/quota-enforcement-repository.mjs
packages/provisioning-orchestrator/src/repositories/quota-override-repository.mjs
packages/provisioning-orchestrator/src/repositories/realtime/AuditRepository.mjs
packages/provisioning-orchestrator/src/repositories/realtime/CaptureAuditRepository.mjs
packages/provisioning-orchestrator/src/repositories/realtime/CaptureConfigRepository.mjs
packages/provisioning-orchestrator/src/repositories/realtime/CaptureQuotaRepository.mjs
packages/provisioning-orchestrator/src/repositories/realtime/ChannelRepository.mjs
packages/provisioning-orchestrator/src/repositories/realtime/MongoCaptureAuditRepository.mjs
packages/provisioning-orchestrator/src/repositories/realtime/MongoCaptureConfigRepository.mjs
packages/provisioning-orchestrator/src/repositories/realtime/MongoCaptureQuotaRepository.mjs
packages/provisioning-orchestrator/src/repositories/realtime/MongoResumeTokenRepository.mjs
packages/provisioning-orchestrator/src/repositories/realtime/QuotaRepository.mjs
packages/provisioning-orchestrator/src/repositories/realtime/SubscriptionRepository.mjs
packages/provisioning-orchestrator/src/repositories/retry-attempt-repo.mjs
packages/provisioning-orchestrator/src/repositories/retry-override-repo.mjs
packages/provisioning-orchestrator/src/repositories/retry-semantics-profile-repo.mjs
packages/provisioning-orchestrator/src/repositories/scope-enforcement-repo.mjs
packages/provisioning-orchestrator/src/repositories/secret-rotation-repo.mjs
packages/provisioning-orchestrator/src/repositories/storage-credential-rotation-repo.mjs
packages/provisioning-orchestrator/src/repositories/tenant-rotation-policy-repo.mjs
packages/provisioning-orchestrator/src/repositories/tenant-usage-snapshot-repository.mjs
packages/provisioning-orchestrator/src/repositories/vector-consumption-repository.mjs
packages/provisioning-orchestrator/src/repositories/workspace-sub-quota-repository.mjs
packages/provisioning-orchestrator/src/reprovision/diff.mjs
packages/provisioning-orchestrator/src/reprovision/identifier-map.mjs
packages/provisioning-orchestrator/src/reprovision/registry.mjs
packages/provisioning-orchestrator/src/reprovision/types.mjs
packages/provisioning-orchestrator/src/schemas/index.mjs
packages/provisioning-orchestrator/src/schemas/migrations/.gitkeep
packages/provisioning-orchestrator/src/schemas/schema-registry.mjs
packages/provisioning-orchestrator/src/schemas/schema-validator.mjs
packages/provisioning-orchestrator/src/schemas/v1.0.0.schema.json
packages/provisioning-orchestrator/src/tests/actions/api-key-domain-migration.test.mjs
packages/provisioning-orchestrator/src/tests/actions/function-privilege-denial-recorder.test.mjs
packages/provisioning-orchestrator/src/tests/actions/privilege-domain-assign.test.mjs
packages/provisioning-orchestrator/src/tests/actions/privilege-domain-audit-query.test.mjs
packages/provisioning-orchestrator/src/tests/actions/tenant-config-export-checksum.test.mjs
packages/provisioning-orchestrator/src/tests/actions/tenant-config-format-versions.test.mjs
packages/provisioning-orchestrator/src/tests/actions/tenant-config-identifier-map.test.mjs
packages/provisioning-orchestrator/src/tests/actions/tenant-config-migrate.test.mjs
packages/provisioning-orchestrator/src/tests/actions/tenant-config-preflight.test.mjs
packages/provisioning-orchestrator/src/tests/actions/tenant-config-reprovision.test.mjs
packages/provisioning-orchestrator/src/tests/actions/tenant-config-validate.test.mjs
packages/provisioning-orchestrator/src/tests/schemas/schema-registry.test.mjs
packages/provisioning-orchestrator/src/tests/schemas/v1.0.0-schema.test.mjs
packages/provisioning-orchestrator/src/tests/secret-inventory.test.mjs
packages/provisioning-orchestrator/src/utils/bucket-name-validator.mjs
packages/provisioning-orchestrator/tests/actions/tenant-config-export-domains.action.test.mjs
packages/provisioning-orchestrator/tests/actions/tenant-config-export.action.test.mjs
packages/provisioning-orchestrator/tests/collectors/functions-collector.test.mjs
packages/provisioning-orchestrator/tests/collectors/iam-collector.test.mjs
packages/provisioning-orchestrator/tests/collectors/kafka-collector.test.mjs
packages/provisioning-orchestrator/tests/collectors/mongo-collector.test.mjs
packages/provisioning-orchestrator/tests/collectors/postgres-collector.test.mjs
packages/provisioning-orchestrator/tests/collectors/s3-collector.test.mjs
packages/provisioning-orchestrator/tests/contract/secret-rotation-api.contract.test.mjs
packages/provisioning-orchestrator/tests/integration/reconcile-buckets-dry-run.integration.test.mjs
packages/provisioning-orchestrator/tests/integration/secret-consumer-propagation.integration.test.mjs
packages/provisioning-orchestrator/tests/integration/secret-rotation-grace-expiry.integration.test.mjs
packages/provisioning-orchestrator/tests/integration/secret-rotation-initiate.integration.test.mjs
packages/provisioning-orchestrator/tests/integration/secret-rotation-multi-tenant-isolation.integration.test.mjs
packages/provisioning-orchestrator/tests/integration/secret-rotation-revoke.integration.test.mjs
packages/provisioning-orchestrator/tests/preflight/conflict-classifier.test.mjs
packages/provisioning-orchestrator/tests/preflight/functions-analyzer.test.mjs
packages/provisioning-orchestrator/tests/preflight/iam-analyzer.test.mjs
packages/provisioning-orchestrator/tests/preflight/kafka-analyzer.test.mjs
packages/provisioning-orchestrator/tests/preflight/mongo-analyzer.test.mjs
packages/provisioning-orchestrator/tests/preflight/postgres-analyzer.test.mjs
packages/provisioning-orchestrator/tests/preflight/recommendation-engine.test.mjs
packages/provisioning-orchestrator/tests/preflight/storage-analyzer.test.mjs
packages/provisioning-orchestrator/tests/reconcilers/bucket-discovery.test.mjs
packages/provisioning-orchestrator/tests/reconcilers/bucket-name-validator.test.mjs
packages/provisioning-orchestrator/tests/reconcilers/bucket-reconciler.test.mjs
packages/provisioning-orchestrator/tests/reconcilers/canonical-mapping.test.mjs
packages/provisioning-orchestrator/tests/reconcilers/compat-gate.test.mjs
packages/provisioning-orchestrator/tests/reconcilers/fixtures/fake-seaweedfs.mjs
packages/provisioning-orchestrator/tests/reconcilers/gap-logger.test.mjs
packages/provisioning-orchestrator/tests/reconcilers/prerequisites.test.mjs
packages/provisioning-orchestrator/tests/reprovision/diff.test.mjs
packages/provisioning-orchestrator/tests/reprovision/functions-applier.test.mjs
packages/provisioning-orchestrator/tests/reprovision/iam-applier.test.mjs
packages/provisioning-orchestrator/tests/reprovision/identifier-map.test.mjs
packages/provisioning-orchestrator/tests/reprovision/kafka-applier.test.mjs
packages/provisioning-orchestrator/tests/reprovision/lock-repository.test.mjs
packages/provisioning-orchestrator/tests/reprovision/mongo-applier.test.mjs
packages/provisioning-orchestrator/tests/reprovision/postgres-applier.test.mjs
packages/provisioning-orchestrator/tests/reprovision/storage-applier.test.mjs
packages/provisioning-orchestrator/tests/secret-consumer-ack.action.test.mjs
packages/provisioning-orchestrator/tests/secret-rotation-event.model.test.mjs
packages/provisioning-orchestrator/tests/secret-rotation-expiry-sweep.action.test.mjs
packages/provisioning-orchestrator/tests/secret-rotation-initiate.action.test.mjs
packages/provisioning-orchestrator/tests/secret-rotation-propagation-timeout-sweep.action.test.mjs
packages/provisioning-orchestrator/tests/secret-rotation-repo.test.mjs
packages/provisioning-orchestrator/tests/secret-rotation-revoke.action.test.mjs
packages/provisioning-orchestrator/tests/secret-version-state.model.test.mjs
packages/provisioning-orchestrator/tests/tenant-effective-capabilities-get.test.mjs
packages/provisioning-orchestrator/tests/unit/realtime/CaptureConfig.test.mjs
packages/provisioning-orchestrator/tests/unit/realtime/CaptureConfigRepository.test.mjs
packages/provisioning-orchestrator/tests/unit/realtime/MongoCaptureConfig.test.mjs
packages/provisioning-orchestrator/tests/unit/realtime/MongoCaptureConfigRepository.test.mjs
packages/provisioning-orchestrator/tests/unit/realtime/mongo-capture-disable.test.mjs
packages/provisioning-orchestrator/tests/unit/realtime/mongo-capture-enable.test.mjs
packages/provisioning-orchestrator/tests/unit/realtime/pg-capture-disable.test.mjs
packages/provisioning-orchestrator/tests/unit/realtime/pg-capture-enable.test.mjs
packages/realtime-gateway/package.json
packages/realtime-gateway/src/actions/handle-scope-revocation.mjs
packages/realtime-gateway/src/actions/validate-subscription-auth.mjs
packages/realtime-gateway/src/audit/audit-publisher.mjs
packages/realtime-gateway/src/auth/scope-checker.mjs
packages/realtime-gateway/src/auth/session-manager.mjs
packages/realtime-gateway/src/auth/token-validator.mjs
packages/realtime-gateway/src/config/env.mjs
packages/realtime-gateway/src/filters/complexity-checker.mjs
packages/realtime-gateway/src/filters/filter-evaluator.mjs
packages/realtime-gateway/src/filters/filter-parser.mjs
packages/realtime-gateway/src/isolation/tenant-workspace-guard.mjs
packages/realtime-gateway/src/migrations/001-create-realtime-scope-channel-mappings.sql
packages/realtime-gateway/src/migrations/002-create-realtime-subscription-auth-records.sql
packages/realtime-gateway/src/migrations/003-create-realtime-sessions.sql
packages/realtime-gateway/src/migrations/004-rls-realtime-sessions.sql
packages/realtime-gateway/src/repositories/auth-record-repository.mjs
packages/realtime-gateway/src/repositories/scope-mapping-repository.mjs
packages/scheduling-engine/.eslintrc.cjs
packages/scheduling-engine/actions/scheduling-job-runner.mjs
packages/scheduling-engine/actions/scheduling-management.mjs
packages/scheduling-engine/actions/scheduling-trigger.mjs
packages/scheduling-engine/migrations/001-scheduling-tables.sql
packages/scheduling-engine/migrations/002-rls-scheduling-tables.sql
packages/scheduling-engine/package.json
packages/scheduling-engine/src/audit.mjs
packages/scheduling-engine/src/config-model.mjs
packages/scheduling-engine/src/cron-validator.mjs
packages/scheduling-engine/src/execution-model.mjs
packages/scheduling-engine/src/job-model.mjs
packages/scheduling-engine/src/quota.mjs
packages/secret-audit-handler/package.json
packages/secret-audit-handler/src/event-schema.mjs
packages/secret-audit-handler/src/index.mjs
packages/secret-audit-handler/src/kafka-publisher.mjs
packages/secret-audit-handler/src/sanitizer.mjs
packages/secret-audit-handler/src/topic-router.mjs
packages/secret-audit-handler/src/vault-log-reader.mjs
packages/secret-audit-handler/tests/integration/audit-handler.integration.test.mjs
packages/secret-audit-handler/tests/integration/secret-audit-topic-isolation.kafka.test.mjs
packages/secret-audit-handler/tests/unit/kafka-publisher.test.mjs
packages/secret-audit-handler/tests/unit/sanitizer.test.mjs
packages/secret-audit-handler/tests/unit/vault-log-reader.test.mjs
packages/webhook-engine/.eslintrc.cjs
packages/webhook-engine/actions/webhook-delivery-worker.mjs
packages/webhook-engine/actions/webhook-dispatcher.mjs
packages/webhook-engine/actions/webhook-management.mjs
packages/webhook-engine/actions/webhook-retry-scheduler.mjs
packages/webhook-engine/migrations/001-webhook-subscriptions.sql
packages/webhook-engine/migrations/002-signing-secret-tenant-scope.sql
packages/webhook-engine/migrations/003-rls-webhook-tables.sql
packages/webhook-engine/migrations/004-webhook-master-key-lifecycle.sql
packages/webhook-engine/package.json
packages/webhook-engine/src/event-catalogue.mjs
packages/webhook-engine/src/webhook-audit.mjs
packages/webhook-engine/src/webhook-delivery.mjs
packages/webhook-engine/src/webhook-master-key-fence.mjs
packages/webhook-engine/src/webhook-master-key-lifecycle.mjs
packages/webhook-engine/src/webhook-master-key.mjs
packages/webhook-engine/src/webhook-quota.mjs
packages/webhook-engine/src/webhook-retry-policy.mjs
packages/webhook-engine/src/webhook-signing.mjs
packages/webhook-engine/src/webhook-subscription.mjs
packages/workspace-docs-service/actions/workspace-docs.mjs
packages/workspace-docs-service/migrations/087-workspace-doc-notes.sql
packages/workspace-docs-service/package.json
packages/workspace-docs-service/src/capability-catalog-builder.mjs
packages/workspace-docs-service/src/config.mjs
packages/workspace-docs-service/src/doc-assembler.mjs
packages/workspace-docs-service/src/doc-audit.mjs
packages/workspace-docs-service/src/note-repository.mjs
packages/workspace-docs-service/src/note-sanitiser.mjs
packages/workspace-docs-service/src/rotation-procedure-section.mjs
packages/workspace-docs-service/src/snippet-context-builder.mjs
packages/workspace-docs-service/tests/doc-assembler.test.mjs
packages/workspace-docs-service/tests/doc-audit.test.mjs
packages/workspace-docs-service/tests/note-repository.test.mjs
packages/workspace-docs-service/tests/note-sanitiser.test.mjs
packages/workspace-docs-service/tests/rotation-procedure-section.test.mjs
packages/workspace-docs-service/tests/workspace-docs.action.test.mjs
packages/workspace-docs-service/tests/workspace-docs.integration.test.mjs
pnpm-lock.yaml
pnpm-workspace.yaml
scripts/backfill-ferretdb-tenant-identities.mjs
scripts/backfill-seaweedfs-identities.mjs
scripts/backfill-tenant-realm-audience.mjs
scripts/backfill-tenant-realm-identity-claims.mjs
scripts/check-control-plane-routes.mjs
scripts/generate-public-api-artifacts.mjs
scripts/lib/audit-traceability.mjs
scripts/lib/authorization-model.mjs
scripts/lib/control-plane-routes.mjs
scripts/lib/deployment-chart.mjs
scripts/lib/deployment-topology.mjs
scripts/lib/domain-model.mjs
scripts/lib/functions-family-source.mjs
scripts/lib/gateway-policy.mjs
scripts/lib/observability-audit-correlation-surface.mjs
scripts/lib/observability-audit-event-schema.mjs
scripts/lib/observability-audit-export-surface.mjs
scripts/lib/observability-audit-pipeline.mjs
scripts/lib/observability-audit-query-surface.mjs
scripts/lib/observability-business-metrics.mjs
scripts/lib/observability-console-alerts.mjs
scripts/lib/observability-dashboards.mjs
scripts/lib/observability-hard-limit-enforcement.mjs
scripts/lib/observability-health-checks.mjs
scripts/lib/observability-metrics-stack.mjs
scripts/lib/observability-quota-policies.mjs
scripts/lib/observability-quota-usage-view.mjs
scripts/lib/observability-threshold-alerts.mjs
scripts/lib/observability-usage-consumption.mjs
scripts/lib/public-api.mjs
scripts/lib/quality-gates.mjs
scripts/lib/service-catalog.mjs
scripts/lib/service-map.mjs
scripts/lib/testing-strategy.mjs
scripts/lint-snippet-templates.mjs
scripts/lint-snippet-templates.test.mjs
scripts/operations/staging-backup-evidence-contract.json
scripts/realtime-snippet-templates.data.mjs
scripts/system-changes/make-all-services-core/README.md
scripts/system-changes/make-all-services-core/backup-kv.sh
scripts/system-changes/make-all-services-core/common.sh
scripts/system-changes/make-all-services-core/diff-rollout.sh
scripts/system-changes/make-all-services-core/health-check.sh
scripts/system-changes/make-all-services-core/migrate-platform-secrets.sh
scripts/system-changes/make-all-services-core/parity-check.sh
scripts/system-changes/make-all-services-core/restore-kv.sh
scripts/validate-authorization-model.mjs
scripts/validate-deployment-chart.mjs
scripts/validate-deployment-topology.mjs
scripts/validate-domain-model.mjs
scripts/validate-gateway-policy.mjs
scripts/validate-image-policy.mjs
scripts/validate-observability-audit-correlation-surface.mjs
scripts/validate-observability-audit-event-schema.mjs
scripts/validate-observability-audit-export-surface.mjs
scripts/validate-observability-audit-pipeline.mjs
scripts/validate-observability-audit-query-surface.mjs
scripts/validate-observability-business-metrics.mjs
scripts/validate-observability-console-alerts.mjs
scripts/validate-observability-dashboards.mjs
scripts/validate-observability-hard-limit-enforcement.mjs
scripts/validate-observability-health-checks.mjs
scripts/validate-observability-metrics-stack.mjs
scripts/validate-observability-quota-policies.mjs
scripts/validate-observability-quota-usage-view.mjs
scripts/validate-observability-threshold-alerts.mjs
scripts/validate-observability-usage-consumption.mjs
scripts/validate-openapi.mjs
scripts/validate-postgresql-tenant-isolation.mjs
scripts/validate-public-api.mjs
scripts/validate-service-catalog.mjs
scripts/validate-service-map.mjs
scripts/validate-structure.mjs
scripts/validate-testing-strategy.mjs
scripts/verify-secret-storage.sh
service-catalog.json
spikes/add-flows-adr-temporal-spikes/.gitignore
spikes/add-flows-adr-temporal-spikes/README.md
spikes/add-flows-adr-temporal-spikes/docker-compose.yml
spikes/add-flows-adr-temporal-spikes/spike-a/activities.mjs
spikes/add-flows-adr-temporal-spikes/spike-a/evidence/kill-resume-assertions.json
spikes/add-flows-adr-temporal-spikes/spike-a/evidence/kill-resume-history.json
spikes/add-flows-adr-temporal-spikes/spike-a/evidence/notes.md
spikes/add-flows-adr-temporal-spikes/spike-a/evidence/replay-result.json
spikes/add-flows-adr-temporal-spikes/spike-a/evidence/replay-source.json
spikes/add-flows-adr-temporal-spikes/spike-a/evidence/sandbox-check.json
spikes/add-flows-adr-temporal-spikes/spike-a/expression-engines.md
spikes/add-flows-adr-temporal-spikes/spike-a/flow.yaml
spikes/add-flows-adr-temporal-spikes/spike-a/package.json
spikes/add-flows-adr-temporal-spikes/spike-a/pnpm-lock.yaml
spikes/add-flows-adr-temporal-spikes/spike-a/run-kill-resume.mjs
spikes/add-flows-adr-temporal-spikes/spike-a/run-replay.mjs
spikes/add-flows-adr-temporal-spikes/spike-a/run-sandbox-check.mjs
spikes/add-flows-adr-temporal-spikes/spike-a/worker-entry.mjs
spikes/add-flows-adr-temporal-spikes/spike-a/workflows.mjs
spikes/add-flows-adr-temporal-spikes/spike-b/comparison-table.md
spikes/add-flows-adr-temporal-spikes/spike-b/conn-count.mjs
spikes/add-flows-adr-temporal-spikes/spike-b/evidence/measurements.json
spikes/add-flows-adr-temporal-spikes/spike-b/measurements.md
spikes/add-flows-adr-temporal-spikes/spike-b/package.json
spikes/add-flows-adr-temporal-spikes/spike-b/pnpm-lock.yaml
spikes/add-flows-adr-temporal-spikes/spike-b/run-measurements.mjs
spikes/add-flows-adr-temporal-spikes/spike-b/worker-entry.mjs
spikes/add-flows-adr-temporal-spikes/spike-b/workflows.mjs
spikes/add-mcp-control-plane-runtime/evidence/kind-e2e-run.txt
spikes/add-mcp-custom-hosting/README.md
spikes/add-mcp-custom-hosting/evidence/byo-deploy.txt
spikes/add-mcp-hosting-adr-spikes/README.md
spikes/add-mcp-hosting-adr-spikes/runtime/Dockerfile
spikes/add-mcp-hosting-adr-spikes/runtime/evidence/invocation.txt
spikes/add-mcp-hosting-adr-spikes/runtime/evidence/scale-to-zero.txt
spikes/add-mcp-hosting-adr-spikes/runtime/ksvc.yaml
spikes/add-mcp-hosting-adr-spikes/runtime/server.mjs
spikes/add-mcp-oauth-authorization-server/README.md
spikes/add-mcp-oauth-authorization-server/evidence/oauth-flow.txt
spikes/add-mcp-oauth-authorization-server/oauth-flow.mjs
spikes/add-mcp-workflows-as-tools/README.md
spikes/add-mcp-workflows-as-tools/evidence/flow-task-lifecycle.txt
spikes/add-mcp-workflows-as-tools/spike-flow-task.mjs
spikes/add-mcp-workflows-as-tools/temporal-dev.yaml
spikes/add-seaweedfs-storage-adr-spike/README.md
spikes/add-seaweedfs-storage-adr-spike/compatibility-matrix.md
spikes/add-seaweedfs-storage-adr-spike/conf/filer.toml
spikes/add-seaweedfs-storage-adr-spike/conf/s3-identities.json
spikes/add-seaweedfs-storage-adr-spike/docker-compose.yml
spikes/add-seaweedfs-storage-adr-spike/evidence/00-version-pin.txt
spikes/add-seaweedfs-storage-adr-spike/evidence/01-postgres2-default-createtable-failure.txt
spikes/add-seaweedfs-storage-adr-spike/evidence/02-s3-gateway-startup-port.txt
spikes/add-seaweedfs-storage-adr-spike/evidence/03-listbuckets.xml
spikes/add-seaweedfs-storage-adr-spike/evidence/04-listobjectsv2.xml
spikes/add-seaweedfs-storage-adr-spike/evidence/04b-regex-parser-result.txt
spikes/add-seaweedfs-storage-adr-spike/evidence/04c-pagination-truncation.txt
spikes/add-seaweedfs-storage-adr-spike/evidence/05-bucket-management-matrix.json
spikes/add-seaweedfs-storage-adr-spike/evidence/06-bucket-policy-principal-shape.txt
spikes/add-seaweedfs-storage-adr-spike/evidence/07-pathstyle-presigned.txt
spikes/add-seaweedfs-storage-adr-spike/evidence/08-postgres-filer-ddl.txt
spikes/add-seaweedfs-storage-adr-spike/evidence/09-delete-cleanup.txt
spikes/add-seaweedfs-storage-adr-spike/evidence/10-identities-live-reload.txt
spikes/add-seaweedfs-storage-adr-spike/findings.md
spikes/add-seaweedfs-storage-adr-spike/probes/matrix.py
spikes/add-seaweedfs-storage-adr-spike/probes/xml-shape.py
spikes/knative-runtime-alternatives/README.md
tests/adapters/README.md
tests/adapters/kafka-admin.test.mjs
tests/adapters/keycloak-admin.test.mjs
tests/adapters/mongodb-admin.test.mjs
tests/adapters/mongodb-data-api.test.mjs
tests/adapters/openwhisk-admin.test.mjs
tests/adapters/postgresql-admin-sql.test.mjs
tests/adapters/postgresql-admin.test.mjs
tests/adapters/postgresql-data-api.test.mjs
tests/adapters/provider-catalog.test.mjs
tests/adapters/reference-fixtures.test.mjs
tests/adapters/seaweedfs-iam-client.test.mjs
tests/adapters/seaweedfs-weed-shell-transport.test.mjs
tests/adapters/storage-access-policy-seaweedfs-actions.test.mjs
tests/adapters/storage-access-policy.test.mjs
tests/adapters/storage-audit-ops.test.mjs
tests/adapters/storage-boundary-provisioning.test.mjs
tests/adapters/storage-capacity-quotas.test.mjs
tests/adapters/storage-event-notifications.test.mjs
tests/adapters/storage-import-export.test.mjs
tests/adapters/storage-multipart-presigned.test.mjs
tests/adapters/storage-programmatic-credentials.test.mjs
tests/adapters/storage-provider-verification.test.mjs
tests/adapters/storage-usage-reporting.test.mjs
tests/blackbox/all-core-install-readiness.test.mjs
tests/blackbox/all-core-kv-migration-scripts.test.mjs
tests/blackbox/api-key-domain-migration-batching.test.mjs
tests/blackbox/apisix-flows-mcp-routes.test.mjs
tests/blackbox/async-operation-trusted-context.test.mjs
tests/blackbox/audit-anomaly-alerting.test.mjs
tests/blackbox/audit-trail-integrity.test.mjs
tests/blackbox/audit-write-and-scope-enforcement.test.mjs
tests/blackbox/auth-signup-password-policy.test.mjs
tests/blackbox/auth-signup-tenant-realm-placement.test.mjs
tests/blackbox/authorization-denial-audit.test.mjs
tests/blackbox/auto-embedding-route-catalog.test.mjs
tests/blackbox/auto-embedding-write.test.mjs
tests/blackbox/backup-status-jwt-signature.test.mjs
tests/blackbox/backup-status-shared-row-isolation.test.mjs
tests/blackbox/bootstrap-job-coldstart-retry.test.mjs
tests/blackbox/bootstrap-job-standalone-apisix.test.mjs
tests/blackbox/bootstrap-realm-brute-force-protection.test.mjs
tests/blackbox/byok-provider-confinement.test.mjs
tests/blackbox/campaign-image-pull-policy.test.mjs
tests/blackbox/cdc-capture-verify-jwt-identity.test.mjs
tests/blackbox/cdc-ferretdb-wal-stack.test.mjs
tests/blackbox/cdc-overflow-dead-letter.test.mjs
tests/blackbox/cdc-ratelimit-key-and-evict.test.mjs
tests/blackbox/cdc-tenant-topic-isolation.test.mjs
tests/blackbox/chart-inline-object-schema.test.mjs
tests/blackbox/console-flow-yaml.test.mjs
tests/blackbox/console-operator-tenant-context.test.mjs
tests/blackbox/console-session-endpoint.test.mjs
tests/blackbox/console-workspace-secrets.test.mjs
tests/blackbox/control-plane-image-imports.test.mjs
tests/blackbox/control-plane-null-body-400.test.mjs
tests/blackbox/control-plane-schema-migration-retry.test.mjs
tests/blackbox/control-plane-secret-backend-health.test.mjs
tests/blackbox/data-export-import-clone.test.mjs
tests/blackbox/data-residency.test.mjs
tests/blackbox/database-delete.test.mjs
tests/blackbox/deploy-completeness-vault-prometheus.test.mjs
tests/blackbox/e2e-failure-diagnostics.test.mjs
tests/blackbox/e2e-preserve-existing-namespace.test.mjs
tests/blackbox/embedding-provider-get-roundtrip.test.mjs
tests/blackbox/embedding-provider-persistence.test.mjs
tests/blackbox/enduser-lifecycle-management.test.mjs
tests/blackbox/event-trigger-integration.test.mjs
tests/blackbox/events-cross-tenant-publish.test.mjs
tests/blackbox/events-physical-topic-workspace-id.test.mjs
tests/blackbox/events-platform-flow-audit-isolation.test.mjs
tests/blackbox/events-topic-tenant-scope.test.mjs
tests/blackbox/executor-5xx-code-redaction.test.mjs
tests/blackbox/executor-apikey-cross-tenant-idor.test.mjs
tests/blackbox/executor-apikey-scope-ceiling.test.mjs
tests/blackbox/executor-credential-workspace-binding.test.mjs
tests/blackbox/executor-ddl-db-ownership-guard.test.mjs
tests/blackbox/executor-ferretdb-netpol-label.test.mjs
tests/blackbox/executor-llm-completion-scope.test.mjs
tests/blackbox/executor-rbac-scope-role-enforcement.test.mjs
tests/blackbox/ferretdb-gateway-mongo-user.test.mjs
tests/blackbox/ferretdb-init-documentdb-host.test.mjs
tests/blackbox/ferretdb-migration-validation.test.mjs
tests/blackbox/ferretdb-rollback-plan.test.mjs
tests/blackbox/ferretdb-tenant-identities.test.mjs
tests/blackbox/flow-activity-workspace-binding.test.mjs
tests/blackbox/flow-stream-apikey-logs.test.mjs
tests/blackbox/flow-trigger-schema-bootstrap.test.mjs
tests/blackbox/flow-trigger-secret-key-failclosed.test.mjs
tests/blackbox/flows-activities.test.mjs
tests/blackbox/flows-activity-ssrf.test.mjs
tests/blackbox/flows-activity-token-gate.test.mjs
tests/blackbox/flows-adr-spike-artifacts.test.mjs
tests/blackbox/flows-api-isolation.test.mjs
tests/blackbox/flows-api-route-catalog.test.mjs
tests/blackbox/flows-api.test.mjs
tests/blackbox/flows-audit-events.test.mjs
tests/blackbox/flows-create-validate-schema.test.mjs
tests/blackbox/flows-dsl-schema.test.mjs
tests/blackbox/flows-execution-control-missing-run.test.mjs
tests/blackbox/flows-execution-credentials.test.mjs
tests/blackbox/flows-execution-events.test.mjs
tests/blackbox/flows-execution-token-not-in-memo.test.mjs
tests/blackbox/flows-interpreter.test.mjs
tests/blackbox/flows-quotas.test.mjs
tests/blackbox/flows-schedule-management.test.mjs
tests/blackbox/flows-subflow-load-referenced-definition.test.mjs
tests/blackbox/flows-task-types.test.mjs
tests/blackbox/flows-temporal-helm.test.mjs
tests/blackbox/flows-tenancy-isolation.test.mjs
tests/blackbox/flows-tenant-teardown.test.mjs
tests/blackbox/flows-triggers-catalog.test.mjs
tests/blackbox/flows-triggers.test.mjs
tests/blackbox/flows-worker-db-activity-wiring.test.mjs
tests/blackbox/flows-worker-dockerfile.test.mjs
tests/blackbox/flows-worker-pg-env-and-search-attrs.test.mjs
tests/blackbox/function-caller-context.test.mjs
tests/blackbox/function-delete-capability.test.mjs
tests/blackbox/function-rollback-history.test.mjs
tests/blackbox/functions-invoke-input-binding.test.mjs
tests/blackbox/functions-ksvc-tenant-namespacing.test.mjs
tests/blackbox/gateway-authn-strip-tenant-headers.test.mjs
tests/blackbox/gateway-per-tenant-rate-limit.test.mjs
tests/blackbox/gateway-shared-secret-provisioning.test.mjs
tests/blackbox/governance-schema-bootstrap.test.mjs
tests/blackbox/helm-wait-documentdb-ordering.test.mjs
tests/blackbox/helpers/authorization-denial-server.mjs
tests/blackbox/iam-realm-binding.test.mjs
tests/blackbox/iam-route-wiring.test.mjs
tests/blackbox/iam-scopes.test.mjs
tests/blackbox/iam-user-credentials.test.mjs
tests/blackbox/kind-advanced-profile.test.mjs
tests/blackbox/kind-control-plane-multirealm-jwt.test.mjs
tests/blackbox/kind-executor-realtime-url-wiring.test.mjs
tests/blackbox/knative-function-tenant-scope.test.mjs
tests/blackbox/legacy-components-absent.test.mjs
tests/blackbox/live-resource-quota-enforcement.test.mjs
tests/blackbox/live-storage-function-quotas.test.mjs
tests/blackbox/llm-complete-activity.test.mjs
tests/blackbox/llm-completion-routes.test.mjs
tests/blackbox/llm-stores.test.mjs
tests/blackbox/managed-knative-console/console-runtime-ui.test.mjs
tests/blackbox/managed-knative-console/function-lifecycle-affordances.test.tsx
tests/blackbox/managed-knative-console/function-mutation-consumer.test-d.ts
tests/blackbox/managed-knative-console/runtime-console-ui.test.tsx
tests/blackbox/managed-knative-console/runtime-status-transport.test.tsx
tests/blackbox/managed-knative-console/tsconfig.json
tests/blackbox/managed-knative-console/vitest.config.ts
tests/blackbox/managed-knative/aggregate-teardown-contract.test.mjs
tests/blackbox/managed-knative/charts-pin-convergence.test.mjs
tests/blackbox/managed-knative/function-contract-alignment.test.mjs
tests/blackbox/managed-knative/function-review-drift.test.mjs
tests/blackbox/managed-knative/mcp-followup-regressions.test.mjs
tests/blackbox/managed-knative/mcp-hosted-runtime-contract.test.mjs
tests/blackbox/managed-knative/mcp-namespace-builder.test.mjs
tests/blackbox/managed-knative/mcp-runtime-api-key-second-hop.test.mjs
tests/blackbox/managed-knative/mcp-runtime-auth-boundary.test.mjs
tests/blackbox/managed-knative/metrics-audit-boundaries.test.mjs
tests/blackbox/managed-knative/runtime-functions.test.mjs
tests/blackbox/mcp-console-route-catalog.test.mjs
tests/blackbox/mcp-hosted-jsonrpc.test.mjs
tests/blackbox/mcp-knative-availability.test.mjs
tests/blackbox/mcp-tool-call-execution.test.mjs
tests/blackbox/mcp-workflow-platform-binding.test.mjs
tests/blackbox/metrics-quotas-degrade.test.mjs
tests/blackbox/metrics-tenant-authorization.test.mjs
tests/blackbox/mongo-browse-tenant-scope.test.mjs
tests/blackbox/mongo-gateway-route.test.mjs
tests/blackbox/mongo-indexes-missing-collection.test.mjs
tests/blackbox/mongo-workspace-document-isolation.test.mjs
tests/blackbox/nonroot-numeric-uid.test.mjs
tests/blackbox/openapi-sdk-cross-tenant.test.mjs
tests/blackbox/openapi-workspace-environment-enum-parity.test.mjs
tests/blackbox/openshift-base-image-override.test.mjs
tests/blackbox/orchestrator-audit-chain.test.mjs
tests/blackbox/pg-browse-tenant-scope.test.mjs
tests/blackbox/pg-insert-request-contract.test.mjs
tests/blackbox/pgvector-dedicated-instance.test.mjs
tests/blackbox/plan-impact-usage-bigint.test.mjs
tests/blackbox/plan-lifecycle-delete.test.mjs
tests/blackbox/plans-list-schema.test.mjs
tests/blackbox/platform-client-default-scopes.test.mjs
tests/blackbox/platform-mcp-completeness.test.mjs
tests/blackbox/platform-mcp-http.test.mjs
tests/blackbox/platform-user-profile-tenant-attr.test.mjs
tests/blackbox/postgres-gateway-route.test.mjs
tests/blackbox/project-auth-config-api.test.mjs
tests/blackbox/quota-read-tenant-scope.test.mjs
tests/blackbox/realtime-auth-flag-fail-closed.test.mjs
tests/blackbox/realtime-refresh-identity-stability.test.mjs
tests/blackbox/realtime-replication-pool-protocol.test.mjs
tests/blackbox/realtime-workspace-scoped-dispatch.test.mjs
tests/blackbox/release-images-workflow.test.mjs
tests/blackbox/reprovision-postgres-ddl-injection.test.mjs
tests/blackbox/run.sh
tests/blackbox/sa-credential-issuance-honor-revocation.test.mjs
tests/blackbox/sa-credential-revocation-invalidate-tokens.test.mjs
tests/blackbox/sa-delete.test.mjs
tests/blackbox/sa-list-backend-collection.test.mjs
tests/blackbox/scheduling-cron-floor.test.mjs
tests/blackbox/scheduling-handler-dockerfile.test.mjs
tests/blackbox/scheduling-identity-token-derivation.test.mjs
tests/blackbox/scheduling-runner-idempotent.test.mjs
tests/blackbox/scheduling-status-filter-injection.test.mjs
tests/blackbox/seaweedfs-bucket-isolation.test.mjs
tests/blackbox/seaweedfs-migration-validation.test.mjs
tests/blackbox/seaweedfs-netpol-bucket-hook.test.mjs
tests/blackbox/seaweedfs-per-tenant-identities.test.mjs
tests/blackbox/seaweedfs-tenant-identities-default-on.test.mjs
tests/blackbox/seaweedfs-tenant-identities.test.mjs
tests/blackbox/seaweedfs-workspace-identity-issuance.test.mjs
tests/blackbox/secret-audit-tenant-isolation.test.mjs
tests/blackbox/secret-audit-value-redaction.test.mjs
tests/blackbox/secret-consumer-ack-auth.test.mjs
tests/blackbox/secret-consumer-status-cross-tenant.test.mjs
tests/blackbox/secrets-rotation-cross-tenant.test.mjs
tests/blackbox/source-build-root-context.test.mjs
tests/blackbox/storage-bucket-ownership-idor.test.mjs
tests/blackbox/storage-bucket-tenant-scope.test.mjs
tests/blackbox/storage-credential-rotation-policy.test.mjs
tests/blackbox/storage-handlers-object-key-validation.test.mjs
tests/blackbox/storage-object-binary-put.test.mjs
tests/blackbox/storage-object-io-completeness.test.mjs
tests/blackbox/storage-object-io-routes.test.mjs
tests/blackbox/storage-object-key-traversal.test.mjs
tests/blackbox/storage-object-not-found-clean-error.test.mjs
tests/blackbox/storage-object-write-envelope.test.mjs
tests/blackbox/storage-per-bucket-credential-scope.test.mjs
tests/blackbox/storage-quota-enforcement.test.mjs
tests/blackbox/storage-quota-handlers.test.mjs
tests/blackbox/structural-write-role-gates-executor.test.mjs
tests/blackbox/structural-write-role-gates-kind.test.mjs
tests/blackbox/superadmin-created-enabled.test.mjs
tests/blackbox/temporal-secret-password-substitution.test.mjs
tests/blackbox/tenant-config-verify-role-claims.test.mjs
tests/blackbox/tenant-create-plan-besteffort.test.mjs
tests/blackbox/tenant-create-slug-conflict-409.test.mjs
tests/blackbox/tenant-custom-rbac.test.mjs
tests/blackbox/tenant-owner-enduser-list.test.mjs
tests/blackbox/tenant-purge-applier-teardown.test.mjs
tests/blackbox/tenant-purge-ferretdb-cascade.test.mjs
tests/blackbox/tenant-purge-ondemand.test.mjs
tests/blackbox/tenant-purge-sweep.test.mjs
tests/blackbox/tenant-purge-workspace-secrets.test.mjs
tests/blackbox/tenant-realm-token-issuance.test.mjs
tests/blackbox/tenant-user-workspace-binding.test.mjs
tests/blackbox/transport-security.test.mjs
tests/blackbox/transport-tls-production-overlay.test.mjs
tests/blackbox/usage-billing-export.test.mjs
tests/blackbox/vault-secrets-backend-kind.test.mjs
tests/blackbox/vault-token-lifecycle.test.mjs
tests/blackbox/vault-workspace-secrets.test.mjs
tests/blackbox/vector-search-ddl.test.mjs
tests/blackbox/vector-search-embedding.test.mjs
tests/blackbox/vector-search-knn-plan.test.mjs
tests/blackbox/vector-search-quota.test.mjs
tests/blackbox/vector-search-route-catalog.test.mjs
tests/blackbox/webhook-db-adapter.test.mjs
tests/blackbox/webhook-management-routes.test.mjs
tests/blackbox/webhook-schema-bootstrap.test.mjs
tests/blackbox/webhook-secret-tenant-scope.test.mjs
tests/blackbox/webhook-ssrf-guard.test.mjs
tests/blackbox/webhook-subscription-id-validation.test.mjs
tests/blackbox/workspace-db-credential-rotation-shared-409.test.mjs
tests/blackbox/workspace-delete-cascade.test.mjs
tests/blackbox/workspace-delete-product.test.mjs
tests/blackbox/workspace-docs-route.test.mjs
tests/blackbox/workspace-environment-promotion.test.mjs
tests/blackbox/workspace-id-claim-minting.test.mjs
tests/blackbox/workspace-quota-enforcement.test.mjs
tests/blackbox/workspace-secrets-shared-store.test.mjs
tests/blackbox/workspace-slug-conflict-409.test.mjs
tests/contract/100-plan-change-impact-history/plan-change-history-query.contract.test.mjs
tests/contract/100-plan-change-impact-history/plan-effective-entitlements-get.contract.test.mjs
tests/contract/103-hard-soft-quota-overrides/quota-contracts.test.mjs
tests/contract/async-operation-query-reconnect.contract.test.mjs
tests/contract/async-operation-query-response.test.mjs
tests/contract/async-operation-state-changed.test.mjs
tests/contract/failure-classified-event.contract.test.mjs
tests/contract/idempotency-dedup-event.contract.test.mjs
tests/contract/intervention-notification-event.contract.test.mjs
tests/contract/manual-intervention-required-event.contract.test.mjs
tests/contract/operation-cancel-event.contract.test.mjs
tests/contract/operation-recovery-event.contract.test.mjs
tests/contract/operation-retry-event.contract.test.mjs
tests/contract/operation-timeout-event.contract.test.mjs
tests/contract/realtime/subscription-lifecycle-event.test.mjs
tests/contract/retry-override-event.contract.test.mjs
tests/contract/rotation-api-contract.test.mjs
tests/contracts/authorization-model.contract.test.mjs
tests/contracts/backup-restore-sandbox.contract.test.mjs
tests/contracts/capability-enforcement-error.contract.test.mjs
tests/contracts/config-preflight-audit-event.contract.test.mjs
tests/contracts/config-reprovision-audit-event.contract.test.mjs
tests/contracts/console-backend-functions.contract.test.mjs
tests/contracts/console-endpoint-separation.contract.test.mjs
tests/contracts/console-workflow-invocation.contract.test.mjs
tests/contracts/console-workflow-job-status.contract.test.mjs
tests/contracts/control-plane.openapi.test.mjs
tests/contracts/deployment-chart.contract.test.mjs
tests/contracts/deployment-topology.contract.test.mjs
tests/contracts/domain-model.contract.test.mjs
tests/contracts/event-kafka-integrations.contract.test.mjs
tests/contracts/flow-definition.contract.test.mjs
tests/contracts/flows-storage-get.contract.test.mjs
tests/contracts/functions-audit.contract.test.mjs
tests/contracts/functions-catalog-runtime-parity.test.mjs
tests/contracts/functions-family-source.test.mjs
tests/contracts/functions-import-export.contract.test.mjs
tests/contracts/functions-quota.contract.test.mjs
tests/contracts/functions-secrets.contract.test.mjs
tests/contracts/functions-versioning.contract.test.mjs
tests/contracts/functions-withdrawal-alignment.test.mjs
tests/contracts/gateway-apikey-routes.contract.test.mjs
tests/contracts/gateway-policy.contract.test.mjs
tests/contracts/helpers/functions-runtime.mjs
tests/contracts/internal-service-map.contract.test.mjs
tests/contracts/keycloak-admin.compatibility.test.mjs
tests/contracts/knative-runtime-deployment.contract.test.mjs
tests/contracts/knative-runtime.contract.test.mjs
tests/contracts/llm-task-type-catalog.contract.test.mjs
tests/contracts/mongodb-admin.compatibility.test.mjs
tests/contracts/mongodb-data-api.compatibility.test.mjs
tests/contracts/observability-audit-correlation-surface.contract.test.mjs
tests/contracts/observability-audit-event-schema.contract.test.mjs
tests/contracts/observability-audit-export-surface.contract.test.mjs
tests/contracts/observability-audit-pipeline.contract.test.mjs
tests/contracts/observability-audit-query-surface.contract.test.mjs
tests/contracts/observability-business-metrics.contract.test.mjs
tests/contracts/observability-console-alerts.contract.test.mjs
tests/contracts/observability-dashboards.contract.test.mjs
tests/contracts/observability-hard-limit-enforcement.contract.test.mjs
tests/contracts/observability-health-checks.contract.test.mjs
tests/contracts/observability-metrics-stack.contract.test.mjs
tests/contracts/observability-quota-policies.contract.test.mjs
tests/contracts/observability-quota-usage-view.contract.test.mjs
tests/contracts/observability-threshold-alerts.contract.test.mjs
tests/contracts/observability-usage-consumption.contract.test.mjs
tests/contracts/postgresql-admin.compatibility.test.mjs
tests/contracts/postgresql-data-api.compatibility.test.mjs
tests/contracts/public-api.catalog.test.mjs
tests/contracts/quota-effective-limits.contract.test.mjs
tests/contracts/scheduling-api.contract.test.mjs
tests/contracts/schemas/async-operation-retry-request.json
tests/contracts/schemas/async-operation-retry-response.json
tests/contracts/schemas/config-preflight-audit-event.json
tests/contracts/schemas/config-reprovision-audit-event.json
tests/contracts/schemas/excess-policy-api.json
tests/contracts/schemas/grace-period-api.json
tests/contracts/schemas/idempotency-dedup-event.json
tests/contracts/schemas/idempotency-key-record.json
tests/contracts/schemas/kafka-events.json
tests/contracts/schemas/operation-retry-event.json
tests/contracts/schemas/plan-change-history-query.json
tests/contracts/schemas/plan-effective-entitlements-get.json
tests/contracts/schemas/policy-evaluation-api.json
tests/contracts/schemas/quota-audit-query.json
tests/contracts/schemas/quota-effective-limits-get.json
tests/contracts/schemas/quota-enforce.json
tests/contracts/schemas/quota-override-create.json
tests/contracts/schemas/quota-override-list.json
tests/contracts/schemas/quota-override-modify.json
tests/contracts/schemas/quota-override-revoke.json
tests/contracts/schemas/restore-test-report.json
tests/contracts/schemas/retry-attempt.json
tests/contracts/schemas/rotation-events.kafka.json
tests/contracts/schemas/rotation-history.schema.json
tests/contracts/schemas/rotation-request.schema.json
tests/contracts/schemas/rotation-status.schema.json
tests/contracts/schemas/tenant-config-identifier-map.json
tests/contracts/schemas/tenant-config-preflight.json
tests/contracts/schemas/tenant-config-reprovision.json
tests/contracts/schemas/tenant-rotation-policy.schema.json
tests/contracts/schemas/transition-rule-api.json
tests/contracts/storage-provider.contract.test.mjs
tests/contracts/tenant-config-identifier-map.contract.test.mjs
tests/contracts/tenant-config-preflight.contract.test.mjs
tests/contracts/tenant-config-reprovision.contract.test.mjs
tests/contracts/tenant-effective-capabilities.contract.test.mjs
tests/contracts/testing-strategy.contract.test.mjs
tests/contracts/webhook-api.contract.test.mjs
tests/contracts/workspace-capability-catalog.contract.test.mjs
tests/contracts/workspace-secret-teardown.contract.test.mjs
tests/contracts/workspace-secrets.contract.test.mjs
tests/e2e-browser/plan-enforcement/console-capability-display.spec.ts
tests/e2e-browser/plan-enforcement/console-quota-display.spec.ts
tests/e2e-browser/playwright.config.ts
tests/e2e/101-plan-upgrade-downgrade-tests/fixtures/mock-usage-unavailable.mjs
tests/e2e/101-plan-upgrade-downgrade-tests/fixtures/seed-plans.mjs
tests/e2e/101-plan-upgrade-downgrade-tests/fixtures/seed-tenant-resources.mjs
tests/e2e/101-plan-upgrade-downgrade-tests/fixtures/teardown.mjs
tests/e2e/101-plan-upgrade-downgrade-tests/helpers/assertion-helpers.mjs
tests/e2e/101-plan-upgrade-downgrade-tests/helpers/audit-query-client.mjs
tests/e2e/101-plan-upgrade-downgrade-tests/helpers/kafka-consumer.mjs
tests/e2e/101-plan-upgrade-downgrade-tests/helpers/plan-api-client.mjs
tests/e2e/101-plan-upgrade-downgrade-tests/helpers/resource-api-client.mjs
tests/e2e/101-plan-upgrade-downgrade-tests/index.test.mjs
tests/e2e/101-plan-upgrade-downgrade-tests/package.json
tests/e2e/101-plan-upgrade-downgrade-tests/scenarios/_shared.mjs
tests/e2e/101-plan-upgrade-downgrade-tests/scenarios/audit-trail-verification.test.mjs
tests/e2e/101-plan-upgrade-downgrade-tests/scenarios/downgrade-surfaces-overlimit.test.mjs
tests/e2e/101-plan-upgrade-downgrade-tests/scenarios/edge-cases.test.mjs
tests/e2e/101-plan-upgrade-downgrade-tests/scenarios/multitenant-isolation.test.mjs
tests/e2e/101-plan-upgrade-downgrade-tests/scenarios/round-trip-transition.test.mjs
tests/e2e/101-plan-upgrade-downgrade-tests/scenarios/upgrade-preserves-resources.test.mjs
tests/e2e/README.md
tests/e2e/console/README.md
tests/e2e/console/backup-restore-sandbox.spec.ts
tests/e2e/console/console-backend-openwhisk.test.mjs
tests/e2e/console/console-test-scaffold.test.mjs
tests/e2e/console/contextual-authorization.test.mjs
tests/e2e/console/functions-import-export.console.test.mjs
tests/e2e/console/postgresql-admin-sql.test.mjs
tests/e2e/console/postgresql-data-api.test.mjs
tests/e2e/console/tenant-bootstrap-journey.test.mjs
tests/e2e/deployment/deployment-smoke.test.mjs
tests/e2e/deployment/mongo-gateway-bearer.test.mjs
tests/e2e/failure-diagnostics.mjs
tests/e2e/fixtures/.gitkeep
tests/e2e/fixtures/flows/flow-definitions.ts
tests/e2e/fixtures/restore/artifact-builder.mjs
tests/e2e/fixtures/restore/assert-equivalence.mjs
tests/e2e/fixtures/restore/cleanup.mjs
tests/e2e/fixtures/restore/cleanup.test.mjs
tests/e2e/fixtures/restore/seed-functions.mjs
tests/e2e/fixtures/restore/seed-iam.mjs
tests/e2e/fixtures/restore/seed-kafka.mjs
tests/e2e/fixtures/restore/seed-mongo.mjs
tests/e2e/fixtures/restore/seed-postgres.mjs
tests/e2e/fixtures/restore/seed-storage.mjs
tests/e2e/fixtures/restore/tenant-factory.mjs
tests/e2e/functions/functions-audit.test.mjs
tests/e2e/helm-temporal-postrenderer/plugin.yaml
tests/e2e/helm-temporal-postrenderer/render.sh
tests/e2e/helpers/api-client.mjs
tests/e2e/helpers/correlation.mjs
tests/e2e/helpers/document-store/document-store-api-client.ts
tests/e2e/helpers/document-store/document-store-gate.ts
tests/e2e/helpers/document-store/tenant-fixtures.ts
tests/e2e/helpers/flows/flows-api-client.ts
tests/e2e/helpers/flows/page-proxy.ts
tests/e2e/helpers/flows/poll.ts
tests/e2e/helpers/flows/tenant-fixtures.ts
tests/e2e/helpers/mcp/mcp-api-client.ts
tests/e2e/helpers/mcp/tenant-fixtures.ts
tests/e2e/helpers/prepare-mongo-gateway.mjs
tests/e2e/helpers/report-writer.mjs
tests/e2e/helpers/report-writer.test.mjs
tests/e2e/helpers/retry.mjs
tests/e2e/helpers/storage/storage-api-client.ts
tests/e2e/helpers/storage/storage-auth.ts
tests/e2e/helpers/storage/storage-gate.ts
tests/e2e/helpers/storage/tenant-fixtures.ts
tests/e2e/issues/bind-event-publish-topic-to-tenant.realstack.test.mjs
tests/e2e/issues/fail-closed-realtime-auth-flag.realstack.test.mjs
tests/e2e/issues/fix-executor-apikey-cross-tenant-idor.realstack.test.mjs
tests/e2e/observability/README.md
tests/e2e/observability/audit-traceability.test.mjs
tests/e2e/observability/observability-smoke.test.mjs
tests/e2e/outbound-webhooks/README.md
tests/e2e/package.json
tests/e2e/playwright.config.ts
tests/e2e/postgresql-tenant-isolation/README.md
tests/e2e/realtime/README.md
tests/e2e/realtime/edge-cases.test.mjs
tests/e2e/realtime/helpers/client.mjs
tests/e2e/realtime/helpers/data-injector.mjs
tests/e2e/realtime/helpers/iam.mjs
tests/e2e/realtime/helpers/kafka-consumer.mjs
tests/e2e/realtime/helpers/poller.mjs
tests/e2e/realtime/helpers/provisioner.mjs
tests/e2e/realtime/helpers/teardown.mjs
tests/e2e/realtime/mongo-tenant-isolation.test.mjs
tests/e2e/realtime/reconnection.test.mjs
tests/e2e/realtime/scope-revocation.test.mjs
tests/e2e/realtime/subscription-lifecycle.test.mjs
tests/e2e/realtime/tenant-isolation.test.mjs
tests/e2e/realtime/workspace-isolation.test.mjs
tests/e2e/run-issue.sh
tests/e2e/run.sh
tests/e2e/specs/console/tenant-admin-journey.spec.ts
tests/e2e/specs/document-store/document-aggregation.spec.ts
tests/e2e/specs/document-store/document-auth.spec.ts
tests/e2e/specs/document-store/document-create.spec.ts
tests/e2e/specs/document-store/document-cross-tenant.spec.ts
tests/e2e/specs/document-store/document-delete.spec.ts
tests/e2e/specs/document-store/document-list.spec.ts
tests/e2e/specs/document-store/document-query.spec.ts
tests/e2e/specs/document-store/document-transaction.spec.ts
tests/e2e/specs/document-store/document-update.spec.ts
tests/e2e/specs/document-store/document-vector-index.spec.ts
tests/e2e/specs/flows/flows-cross-tenant.spec.ts
tests/e2e/specs/flows/flows-design-publish.spec.ts
tests/e2e/specs/flows/flows-failure-retry.spec.ts
tests/e2e/specs/flows/flows-human-approval.spec.ts
tests/e2e/specs/flows/flows-run-observe.spec.ts
tests/e2e/specs/flows/flows-triggers.spec.ts
tests/e2e/specs/flows/flows-version-pinning.spec.ts
tests/e2e/specs/flows/flows-worker-kill.spec.ts
tests/e2e/specs/issues/.gitkeep
tests/e2e/specs/issues/add-ferretdb-document-store-e2e.spec.ts
tests/e2e/specs/issues/add-mcp-e2e.spec.ts
tests/e2e/specs/issues/add-seaweedfs-storage-e2e.spec.ts
tests/e2e/specs/issues/fix-cdc-capture-verify-jwt-identity.spec.ts
tests/e2e/specs/issues/fix-pg-capture-insert-conflict-arbiter.spec.ts
tests/e2e/specs/issues/flows-e2e-issue-367.spec.ts
tests/e2e/specs/issues/issue-933-managed-knative-runtime.spec.ts
tests/e2e/specs/issues/validate-reprovision-postgres-ddl.spec.ts
tests/e2e/specs/mcp/README.md
tests/e2e/specs/mcp/mcp-cross-tenant.spec.ts
tests/e2e/specs/mcp/mcp-full-loop.spec.ts
tests/e2e/specs/mcp/mcp-version-pinning.spec.ts
tests/e2e/specs/storage/README-seaweedfs-run.md
tests/e2e/specs/storage/storage-cross-tenant.spec.ts
tests/e2e/specs/storage/storage-list-buckets.spec.ts
tests/e2e/specs/storage/storage-list-objects.spec.ts
tests/e2e/specs/storage/storage-object-metadata.spec.ts
tests/e2e/specs/storage/storage-provision-bucket.spec.ts
tests/e2e/specs/storage/storage-workspace-usage.spec.ts
tests/e2e/stack.sh
tests/e2e/storage-bucket-policies/README.md
tests/e2e/storage-capacity-quotas/README.md
tests/e2e/storage-event-notifications/README.md
tests/e2e/storage-multipart-presigned/README.md
tests/e2e/storage-provider-verification/README.md
tests/e2e/values-integration.yaml
tests/e2e/workflows/audit-traceability.test.mjs
tests/e2e/workflows/compensation-retry.test.mjs
tests/e2e/workflows/fixtures/fault-injection/.gitkeep
tests/e2e/workflows/fixtures/fault-injection/fail-at-last-step.json
tests/e2e/workflows/fixtures/fault-injection/fail-at-step-2.json
tests/e2e/workflows/fixtures/workflow-configs/.gitkeep
tests/e2e/workflows/fixtures/workflow-configs/wf-con-002.json
tests/e2e/workflows/fixtures/workflow-configs/wf-con-003.json
tests/e2e/workflows/fixtures/workflow-configs/wf-con-004.json
tests/e2e/workflows/happy-path.test.mjs
tests/e2e/workflows/helpers/.gitkeep
tests/e2e/workflows/helpers/audit-asserter.mjs
tests/e2e/workflows/helpers/fault-injector.mjs
tests/e2e/workflows/helpers/idempotency-tracker.mjs
tests/e2e/workflows/helpers/tenant-context.mjs
tests/e2e/workflows/helpers/workflow-runner.mjs
tests/e2e/workflows/idempotency.test.mjs
tests/e2e/workflows/index.mjs
tests/e2e/workflows/multi-tenant-isolation.test.mjs
tests/e2e/workflows/partial-failure.test.mjs
tests/e2e/workflows/restore/README.md
tests/e2e/workflows/restore/e1-full-restore-empty-tenant.test.mjs
tests/e2e/workflows/restore/e2-partial-restore-domain-subset.test.mjs
tests/e2e/workflows/restore/e3-restore-with-conflicts.test.mjs
tests/e2e/workflows/restore/e4-restore-degraded-artifact.test.mjs
tests/e2e/workflows/restore/e5-restore-format-migration.test.mjs
tests/e2e/workflows/restore/ec1-partial-failure-retry.test.mjs
tests/e2e/workflows/restore/ec2-tenant-id-mismatch.test.mjs
tests/e2e/workflows/restore/ec3-concurrent-restore-blocked.test.mjs
tests/e2e/workflows/restore/ec4-max-size-artifact.test.mjs
tests/e2e/workflows/restore/ec5-suspended-tenant-rejected.test.mjs
tests/e2e/workflows/restore/index.test.mjs
tests/e2e/workflows/tenant-config-preflight.test.mjs
tests/e2e/workflows/tenant-config-reprovision.test.mjs
tests/e2e/workspace-scheduling/README.md
tests/env/.gitignore
tests/env/README.md
tests/env/action-runner/Dockerfile
tests/env/action-runner/package.json
tests/env/action-runner/routes.mjs
tests/env/action-runner/server.mjs
tests/env/apisix/apisix.yaml
tests/env/apisix/config.yaml
tests/env/audit-enforcement-logging.test.mjs
tests/env/docker-compose.yml
tests/env/down.sh
tests/env/e2e-smoke/.gitignore
tests/env/e2e-smoke/async-operation-http-slice.spec.ts
tests/env/e2e-smoke/backup-status-http-slice.spec.ts
tests/env/e2e-smoke/package.json
tests/env/e2e-smoke/plan-change-history-http-slice.spec.ts
tests/env/e2e-smoke/plan-quota-http-slice.spec.ts
tests/env/e2e-smoke/playwright.config.ts
tests/env/e2e-smoke/run.sh
tests/env/e2e-smoke/scheduling-http-slice.spec.ts
tests/env/e2e-smoke/tenant-entitlements-http-slice.spec.ts
tests/env/e2e-smoke/workspace-sub-quota-http-slice.spec.ts
tests/env/env.sh
tests/env/executor/app-api-keys-rls.test.mjs
tests/env/executor/auto-embedding-write.test.mjs
tests/env/executor/cdc-resume-durability.test.mjs
tests/env/executor/cdc-wal.test.mjs
tests/env/executor/control-plane-http.test.mjs
tests/env/executor/data-api-roles.mjs
tests/env/executor/embedding-provider-persistence.test.mjs
tests/env/executor/events-executor.test.mjs
tests/env/executor/external-application-store.test.mjs
tests/env/executor/functions-executor.test.mjs
tests/env/executor/mongo-data-executor.test.mjs
tests/env/executor/postgres-data-executor.test.mjs
tests/env/executor/postgres-ddl-executor.test.mjs
tests/env/executor/postgres-ddl-grants-rls.test.mjs
tests/env/executor/postgres-extension-preflight.test.mjs
tests/env/executor/postgres-realtime-executor.test.mjs
tests/env/executor/realtime-executor.test.mjs
tests/env/executor/run-cdc-resume.sh
tests/env/executor/run-cdc-wal.sh
tests/env/executor/run-events.sh
tests/env/executor/run-ferretdb-cascade.sh
tests/env/executor/run-functions.sh
tests/env/executor/run-mongo.sh
tests/env/executor/run-realtime.sh
tests/env/executor/run-wal.sh
tests/env/executor/run.sh
tests/env/executor/tenant-environments.test.mjs
tests/env/executor/tenant-purge-cascade.test.mjs
tests/env/executor/tenant-purge-ferretdb-cascade.test.mjs
tests/env/executor/vector-capability-unavailable.test.mjs
tests/env/executor/vector-search-knn-rls.test.mjs
tests/env/executor/wal-replication.test.mjs
tests/env/executor/workspace-db-dedicated-credential.test.mjs
tests/env/executor/workspace-db-routing.test.mjs
tests/env/executor/workspace-environment-promotion.test.mjs
tests/env/ferretdb-gateway-auth.test.mjs
tests/env/flow-audit-outbox/flow-audit-outbox.test.mjs
tests/env/flow-audit-outbox/run.sh
tests/env/flows-api/flows-rls.test.mjs
tests/env/flows-api/run.sh
tests/env/flows-db-query-rls.test.mjs
tests/env/flows-events-publish.test.mjs
tests/env/flows-execution-credential-roundtrip.test.mjs
tests/env/flows-http-ssrf.test.mjs
tests/env/flows-monitoring/execution-stream.test.mjs
tests/env/flows-monitoring/run.sh
tests/env/flows-tenant-cascade.test.mjs
tests/env/flows-triggers/run.sh
tests/env/flows-triggers/trigger-lifecycle.test.mjs
tests/env/keycloak-e2e-provision.sh
tests/env/keycloak/auth-ropc-user-profile.test.mjs
tests/env/keycloak/import/tenant-a-realm.json
tests/env/keycloak/import/tenant-b-realm.json
tests/env/keycloak/run.sh
tests/env/keycloak/workspace-id-claim.test.mjs
tests/env/pg-control-table-grants/pg-control-table-least-privilege.test.mjs
tests/env/pg-control-table-grants/run.sh
tests/env/quota-consumption-live-schema.test.mjs
tests/env/rls/rls-tenant-isolation.test.mjs
tests/env/rls/run.sh
tests/env/run.sh
tests/env/seaweedfs/conf/s3-identities.json
tests/env/seaweedfs/run-tenant-identities.sh
tests/env/seaweedfs/run.sh
tests/env/seaweedfs/seaweedfs-reconcile.test.mjs
tests/env/seaweedfs/seaweedfs-tenant-identities.test.mjs
tests/env/up.sh
tests/env/validation/ferretdb-parity-check.mjs
tests/env/validation/ferretdb-smoke-data-api.mjs
tests/env/validation/parity-check.mjs
tests/env/validation/run-ferretdb-validation.sh
tests/env/validation/run-validation.sh
tests/env/validation/smoke-storage.mjs
tests/env/validation/wait-ferretdb.mjs
tests/env/workflow-worker/_harness.mjs
tests/env/workflow-worker/approval-cancel.test.mjs
tests/env/workflow-worker/node-id-naming.test.mjs
tests/env/workflow-worker/replay.test.mjs
tests/env/workflow-worker/run.sh
tests/env/workflow-worker/sequence-and-retry.test.mjs
tests/env/workflow-worker/subflow-load-referenced-definition.test.mjs
tests/env/workflow-worker/version-pinning.test.mjs
tests/env/workflow-worker/worker-kill-resume.test.mjs
tests/hardening/README.md
tests/hardening/lib/audit-verifier.mjs
tests/hardening/lib/enforcement-mode.mjs
tests/hardening/lib/fixtures.mjs
tests/hardening/lib/fixtures.smoke.test.mjs
tests/hardening/lib/http-client.mjs
tests/hardening/lib/reporter.mjs
tests/hardening/package.json
tests/hardening/run.mjs
tests/hardening/suites/function-privilege.test.mjs
tests/hardening/suites/plan-restriction.test.mjs
tests/hardening/suites/privilege-domain.test.mjs
tests/hardening/suites/scope-enforcement.test.mjs
tests/hardening/suites/secret-lifecycle.test.mjs
tests/hardening/suites/tenant-isolation.test.mjs
tests/helpers/control-plane-sdk-boundary-loader.mjs
tests/helpers/database-delete-fixture.mjs
tests/helpers/fake-openbao-kv.mjs
tests/helpers/function-invocation-fixture.mjs
tests/helpers/http-request.mjs
tests/helpers/idempotency-database.mjs
tests/helpers/live-quota-fixture.mjs
tests/helpers/postgres-boundary-loader.mjs
tests/helpers/postgres-boundary.mjs
tests/helpers/unused-driver-boundary.mjs
tests/helpers/webhook-key.mjs
tests/integration/097-plan-entity-tenant-assignment/audit-chain-integrity.test.mjs
tests/integration/097-plan-entity-tenant-assignment/fixtures/create-test-tenant.mjs
tests/integration/097-plan-entity-tenant-assignment/fixtures/seed-plans.mjs
tests/integration/097-plan-entity-tenant-assignment/plan-assignment.test.mjs
tests/integration/097-plan-entity-tenant-assignment/plan-audit.test.mjs
tests/integration/097-plan-entity-tenant-assignment/plan-catalog.test.mjs
tests/integration/097-plan-entity-tenant-assignment/plan-delete.test.mjs
tests/integration/097-plan-entity-tenant-assignment/plan-isolation.test.mjs
tests/integration/097-plan-entity-tenant-assignment/plan-lifecycle.test.mjs
tests/integration/098-plan-base-limits/catalog.test.mjs
tests/integration/098-plan-base-limits/fixtures/seed-catalog.mjs
tests/integration/098-plan-base-limits/fixtures/seed-plans.mjs
tests/integration/098-plan-base-limits/plan-limits-audit.test.mjs
tests/integration/098-plan-base-limits/plan-limits-isolation.test.mjs
tests/integration/098-plan-base-limits/plan-limits-profile.test.mjs
tests/integration/098-plan-base-limits/plan-limits-set.test.mjs
tests/integration/099-plan-management-api-console/fixtures/seed-assignments.mjs
tests/integration/099-plan-management-api-console/fixtures/seed-plans.mjs
tests/integration/099-plan-management-api-console/fixtures/seed-tenants.mjs
tests/integration/099-plan-management-api-console/plan-api.test.mjs
tests/integration/099-plan-management-api-console/plan-assignment-api.test.mjs
tests/integration/099-plan-management-api-console/plan-auth.test.mjs
tests/integration/099-plan-management-api-console/plan-isolation.test.mjs
tests/integration/099-plan-management-api-console/plan-limits-api.test.mjs
tests/integration/100-plan-change-impact-history/downgrade-overlimit.test.mjs
tests/integration/100-plan-change-impact-history/effective-entitlements-get.test.mjs
tests/integration/100-plan-change-impact-history/fixtures/mock-usage-unavailable.mjs
tests/integration/100-plan-change-impact-history/fixtures/seed-plan-history.mjs
tests/integration/100-plan-change-impact-history/fixtures/seed-tenant-usage.mjs
tests/integration/100-plan-change-impact-history/plan-change-history-auth.test.mjs
tests/integration/100-plan-change-impact-history/plan-change-history-query.test.mjs
tests/integration/100-plan-change-impact-history/plan-change-history-write.test.mjs
tests/integration/103-hard-soft-quota-overrides/fixtures/seed-overrides.mjs
tests/integration/103-hard-soft-quota-overrides/fixtures/seed-plans-with-quota-types.mjs
tests/integration/103-hard-soft-quota-overrides/fixtures/seed-tenants.mjs
tests/integration/103-hard-soft-quota-overrides/fixtures/seed-usage.mjs
tests/integration/103-hard-soft-quota-overrides/quota-audit.test.mjs
tests/integration/103-hard-soft-quota-overrides/quota-effective-limits.test.mjs
tests/integration/103-hard-soft-quota-overrides/quota-enforcement.test.mjs
tests/integration/103-hard-soft-quota-overrides/quota-isolation.test.mjs
tests/integration/103-hard-soft-quota-overrides/quota-override-crud.test.mjs
tests/integration/103-hard-soft-quota-overrides/quota-override-expiry.test.mjs
tests/integration/103-hard-soft-quota-overrides/quota-type-classification.test.mjs
tests/integration/104-plan-boolean-capabilities/capability-audit.test.mjs
tests/integration/104-plan-boolean-capabilities/capability-catalog.test.mjs
tests/integration/104-plan-boolean-capabilities/capability-isolation.test.mjs
tests/integration/104-plan-boolean-capabilities/fixtures/seed-capability-catalog.mjs
tests/integration/104-plan-boolean-capabilities/fixtures/seed-plans-with-capabilities.mjs
tests/integration/104-plan-boolean-capabilities/plan-capability-crud.test.mjs
tests/integration/104-plan-boolean-capabilities/plan-capability-profile.test.mjs
tests/integration/104-plan-boolean-capabilities/tenant-effective-capabilities.test.mjs
tests/integration/105-effective-limit-resolution/concurrency.test.mjs
tests/integration/105-effective-limit-resolution/fixtures/seed-overrides.mjs
tests/integration/105-effective-limit-resolution/fixtures/seed-plans-with-quotas-and-capabilities.mjs
tests/integration/105-effective-limit-resolution/fixtures/seed-sub-quotas.mjs
tests/integration/105-effective-limit-resolution/inconsistency-detection.test.mjs
tests/integration/105-effective-limit-resolution/isolation.test.mjs
tests/integration/105-effective-limit-resolution/unified-entitlements.test.mjs
tests/integration/105-effective-limit-resolution/upstream-change-reflection.test.mjs
tests/integration/105-effective-limit-resolution/workspace-effective-limits.test.mjs
tests/integration/105-effective-limit-resolution/workspace-sub-quota-crud.test.mjs
tests/integration/106-consumption-visibility-console/allocation-summary.test.mjs
tests/integration/106-consumption-visibility-console/fixtures/seed-tenant-with-plan-and-resources.mjs
tests/integration/106-consumption-visibility-console/fixtures/seed-workspace-with-sub-quotas.mjs
tests/integration/106-consumption-visibility-console/isolation.test.mjs
tests/integration/106-consumption-visibility-console/over-limit.test.mjs
tests/integration/106-consumption-visibility-console/tenant-consumption-snapshot.test.mjs
tests/integration/106-consumption-visibility-console/unlimited-dimension.test.mjs
tests/integration/106-consumption-visibility-console/workspace-consumption.test.mjs
tests/integration/114-backup-scope-deployment-profiles/backup-scope-audit.test.mjs
tests/integration/114-backup-scope-deployment-profiles/backup-scope-get.test.mjs
tests/integration/114-backup-scope-deployment-profiles/fixtures/seed-backup-scope.mjs
tests/integration/114-backup-scope-deployment-profiles/tenant-backup-scope-get.test.mjs
tests/integration/115-functional-config-export/domains-api.test.mjs
tests/integration/115-functional-config-export/export-api.test.mjs
tests/integration/115-functional-config-export/fixtures/keycloak-realm-seed.json
tests/integration/115-functional-config-export/fixtures/tenant-seed.sql
tests/integration/115-functional-config-export/helpers/mock-collectors.mjs
tests/integration/975-tenant-invitations/store.test.mjs
tests/integration/async-operation-orphan-candidates.test.mjs
tests/integration/async-operation-policy-per-type.test.mjs
tests/integration/async-operation-query-integration.test.mjs
tests/integration/async-operation-repo.test.mjs
tests/integration/async-operation-timeout-candidates.test.mjs
tests/integration/backup-restore-sandbox.test.mjs
tests/integration/failure-classification-mapping.test.mjs
tests/integration/http-idempotency-postgres.test.mjs
tests/integration/idempotency-dedup.test.mjs
tests/integration/idempotency-key-expiry.test.mjs
tests/integration/manual-intervention-lifecycle.test.mjs
tests/integration/plan-enforcement/README.md
tests/integration/plan-enforcement/config/test-capabilities.mjs
tests/integration/plan-enforcement/config/test-env.mjs
tests/integration/plan-enforcement/config/test-plans.mjs
tests/integration/plan-enforcement/helpers/api-client.mjs
tests/integration/plan-enforcement/helpers/auth.mjs
tests/integration/plan-enforcement/helpers/console-api-client.mjs
tests/integration/plan-enforcement/helpers/kafka-consumer.mjs
tests/integration/plan-enforcement/helpers/override-factory.mjs
tests/integration/plan-enforcement/helpers/plan-factory.mjs
tests/integration/plan-enforcement/helpers/report.mjs
tests/integration/plan-enforcement/helpers/resource-factory.mjs
tests/integration/plan-enforcement/helpers/tenant-factory.mjs
tests/integration/plan-enforcement/helpers/wait-for-propagation.mjs
tests/integration/plan-enforcement/helpers/workspace-factory.mjs
tests/integration/plan-enforcement/run-suite.sh
tests/integration/plan-enforcement/suites/01-resolution-gateway-coherence.test.mjs
tests/integration/plan-enforcement/suites/02-resolution-console-coherence.test.mjs
tests/integration/plan-enforcement/suites/03-gateway-console-coherence.test.mjs
tests/integration/plan-enforcement/suites/04-plan-change-propagation.test.mjs
tests/integration/plan-enforcement/suites/05-override-propagation.test.mjs
tests/integration/plan-enforcement/suites/06-hard-quota-enforcement.test.mjs
tests/integration/plan-enforcement/suites/07-soft-quota-grace-enforcement.test.mjs
tests/integration/plan-enforcement/suites/08-workspace-subquota-coherence.test.mjs
tests/integration/plan-enforcement/suites/10-deny-by-default.test.mjs
tests/integration/plan-enforcement/suites/11-audit-enforcement-events.test.mjs
tests/integration/plan-enforcement/suites/12-capability-quota-orthogonality.test.mjs
tests/integration/plan-enforcement/suites/13-multi-tenant-isolation.test.mjs
tests/integration/plan-enforcement/suites/14-full-lifecycle-e2e.test.mjs
tests/integration/plan-enforcement/suites/15-workspace-iam-client-create.test.mjs
tests/integration/realtime-gateway/event-filter-enforcement.test.mjs
tests/integration/realtime-gateway/subscription-auth-flow.test.mjs
tests/integration/realtime/quota-enforcement.test.mjs
tests/integration/realtime/subscription-crud.test.mjs
tests/integration/realtime/subscription-resolver.test.mjs
tests/integration/retry-safe.test.mjs
tests/integration/retry-semantics-profile-query.test.mjs
tests/integration/scheduling-job-runner.test.mjs
tests/integration/scheduling-management-action.test.mjs
tests/integration/scheduling-trigger.test.mjs
tests/integration/secret-storage/consumer-status-cross-tenant.integration.test.mjs
tests/integration/secret-storage/eso-sync.test.mjs
tests/integration/secret-storage/fail-closed.test.mjs
tests/integration/secret-storage/inventory-api.test.mjs
tests/integration/secret-storage/secret-no-plaintext.test.mjs
tests/integration/secret-storage/vault-access-control.test.mjs
tests/integration/secret-storage/vault-audit-log.test.mjs
tests/integration/webhook-delivery-worker.test.mjs
tests/integration/webhook-dispatcher.test.mjs
tests/integration/webhook-management-action.test.mjs
tests/integration/webhook-master-key-lifecycle.test.mjs
tests/integration/webhook-master-key-postgres.test.mjs
tests/integration/workspace-capability-catalog.integration.test.mjs
tests/reference/README.md
tests/reference/audit-traceability-matrix.yaml
tests/reference/deployment-smoke-matrix.yaml
tests/reference/domain-seed-fixtures.json
tests/reference/observability-smoke-matrix.yaml
tests/reference/reference-dataset.json
tests/reference/testing-strategy.yaml
tests/resilience/README.md
tests/resilience/authorization-negative-scenarios.test.mjs
tests/resilience/backup-restore-sandbox.test.mjs
tests/resilience/console-backend-authorization.test.mjs
tests/resilience/console-workflow-authorization.test.mjs
tests/resilience/event-gateway-load.test.mjs
tests/resilience/functions-audit-authorization.test.mjs
tests/resilience/functions-import-export-security.test.mjs
tests/resilience/gateway-access-matrix.test.mjs
tests/resilience/gateway-hardening.test.mjs
tests/resilience/mongodb-data-api-security.test.mjs
tests/resilience/postgresql-admin-sql-security.test.mjs
tests/resilience/postgresql-data-api-security.test.mjs
tests/resilience/resilience-scaffold.test.mjs
tests/resilience/tenant-bootstrap-retry.test.mjs
tests/saga/saga-compensation.test.mjs
tests/saga/saga-definitions.test.mjs
tests/saga/saga-engine.test.mjs
tests/saga/saga-idempotency.test.mjs
tests/saga/saga-state-store.test.mjs
tests/scope-enforcement/audit-query.integration.test.mjs
tests/scope-enforcement/plugin.integration.test.mjs
tests/unit/api-keys-scope-ceiling.test.mjs
tests/unit/async-operation-cancel.test.mjs
tests/unit/async-operation-intervention-notify.test.mjs
tests/unit/async-operation-model-extended.test.mjs
tests/unit/async-operation-orphan-sweep.test.mjs
tests/unit/async-operation-policy.test.mjs
tests/unit/async-operation-query-repo.test.mjs
tests/unit/async-operation-retry-override.test.mjs
tests/unit/async-operation-retry-semantics.test.mjs
tests/unit/async-operation-retry.test.mjs
tests/unit/async-operation-states-extended.test.mjs
tests/unit/async-operation-states-regression.test.mjs
tests/unit/async-operation-states.test.mjs
tests/unit/async-operation-timeout-sweep.test.mjs
tests/unit/async-operation.test.mjs
tests/unit/async-operations-schema-bootstrap.test.mjs
tests/unit/audit.test.mjs
tests/unit/authorization-denial-audit.test.mjs
tests/unit/authorization-model.test.mjs
tests/unit/backfill-seaweedfs-identities.test.mjs
tests/unit/backup-restore-sandbox.test.mjs
tests/unit/capability-catalog-builder.test.mjs
tests/unit/ci-workflow-action-pins.test.mjs
tests/unit/config-model.test.mjs
tests/unit/console-auth.test.mjs
tests/unit/console-backend-functions.test.mjs
tests/unit/console-logout-revoke-session.test.mjs
tests/unit/console-status-views-route.test.mjs
tests/unit/control-plane-apikey-identity.test.mjs
tests/unit/control-plane-database-startup.test.mjs
tests/unit/control-plane-fallthrough-proxy.test.mjs
tests/unit/control-plane-jwt-identity.test.mjs
tests/unit/control-plane-jwt-verify.test.mjs
tests/unit/control-plane-mongo-list-query.test.mjs
tests/unit/control-plane-pg-realtime-sse.test.mjs
tests/unit/control-plane-realtime-sse.test.mjs
tests/unit/credential-rotation-expiry-sweep.test.mjs
tests/unit/cron-validator.test.mjs
tests/unit/database-delete.test.mjs
tests/unit/dependency-overrides.test.mjs
tests/unit/deployment-chart.test.mjs
tests/unit/deployment-topology.test.mjs
tests/unit/dimension-quota.test.mjs
tests/unit/documentdb-identity-applier.test.mjs
tests/unit/domain-model.test.mjs
tests/unit/embedding-mapping-store.test.mjs
tests/unit/event-gateway-runtime.test.mjs
tests/unit/event-kafka-integrations.test.mjs
tests/unit/events-admin.test.mjs
tests/unit/execution-model.test.mjs
tests/unit/executor-public-error-code.test.mjs
tests/unit/executor-workspace-binding.test.mjs
tests/unit/external-application-iam.test.mjs
tests/unit/external-application-kc-admin.test.mjs
tests/unit/external-application-routes.test.mjs
tests/unit/failure-classification.test.mjs
tests/unit/flow-definition-validator.test.mjs
tests/unit/flow-executor-workflow-id.test.mjs
tests/unit/flow-monitoring-executor.test.mjs
tests/unit/flow-schedule-temporal-reconnect.test.mjs
tests/unit/flow-trigger-registry.test.mjs
tests/unit/flow-validator-language.test.mjs
tests/unit/flow-write-role-gate.test.mjs
tests/unit/flows-activity-catalog.test.mjs
tests/unit/flows-activity-limits.test.mjs
tests/unit/flows-interpreter-mapping.test.mjs
tests/unit/function-deploy-tenant-scope.test.mjs
tests/unit/function-invocation-auth.test.mjs
tests/unit/function-knative-availability.test.mjs
tests/unit/function-lifecycle-ownership-wiring.test.mjs
tests/unit/function-list-tenant-scope.test.mjs
tests/unit/function-mutation-authorization.test.mjs
tests/unit/function-update-route-method.test.mjs
tests/unit/functions-admin.test.mjs
tests/unit/functions-audit.test.mjs
tests/unit/gateway-policy.test.mjs
tests/unit/gateway-realtime-docs.test.mjs
tests/unit/governance-schema-search-path-reset.test.mjs
tests/unit/helpers/control-plane-metrics-server.mjs
tests/unit/http-idempotency-contract.test.mjs
tests/unit/http-idempotency-control-plane.test.mjs
tests/unit/http-idempotency-generation.test.mjs
tests/unit/http-idempotency-purge.test.mjs
tests/unit/http-idempotency-server.test.mjs
tests/unit/http-idempotency.test.mjs
tests/unit/http-metric-route-labels.test.mjs
tests/unit/iam-admin.test.mjs
tests/unit/iam-create-role-contract-fields.test.mjs
tests/unit/iam-create-user-contract-fields.test.mjs
tests/unit/iam-governance.test.mjs
tests/unit/iam-keycloak-error-sanitization.test.mjs
tests/unit/idempotency-dedup-in-create.test.mjs
tests/unit/idempotency-key-record.test.mjs
tests/unit/invitation-public-api-family.test.mjs
tests/unit/job-model.test.mjs
tests/unit/kafka-handlers-metadata-recovery.test.mjs
tests/unit/kafka-handlers-publish-validation.test.mjs
tests/unit/kafka-handlers-workspace-routes.test.mjs
tests/unit/keycloak-public-base.test.mjs
tests/unit/knative-observability.test.mjs
tests/unit/knative-runtime-auth-errors.test.mjs
tests/unit/knative-runtime-image-wiring.test.mjs
tests/unit/knative-runtime-status-route.test.mjs
tests/unit/knative-runtime.test.mjs
tests/unit/knative-status-authz-wiring.test.mjs
tests/unit/managed-knative-function-cleanup-ownership.test.mjs
tests/unit/manual-intervention-flag.test.mjs
tests/unit/mcp-console-detail-runtime-route.test.mjs
tests/unit/mcp-knative-metrics.test.mjs
tests/unit/mcp-runtime-adapter.test.mjs
tests/unit/mcp-runtime-cleaner.test.mjs
tests/unit/mcp-runtime-headers.test.mjs
tests/unit/metrics-registry.test.mjs
tests/unit/model-authz.test.mjs
tests/unit/mongo-admin.test.mjs
tests/unit/mongo-data-api.test.mjs
tests/unit/mongo-data-executor-objectid.test.mjs
tests/unit/observability-audit-correlation-surface.test.mjs
tests/unit/observability-audit-event-schema.test.mjs
tests/unit/observability-audit-export-surface.test.mjs
tests/unit/observability-audit-pipeline.test.mjs
tests/unit/observability-audit-query-surface.test.mjs
tests/unit/observability-audit-traceability.test.mjs
tests/unit/observability-business-metrics.test.mjs
tests/unit/observability-console-alerts.test.mjs
tests/unit/observability-dashboards.test.mjs
tests/unit/observability-hard-limit-enforcement.test.mjs
tests/unit/observability-health-checks.test.mjs
tests/unit/observability-metrics-stack.test.mjs
tests/unit/observability-quota-enforcement-verification.test.mjs
tests/unit/observability-quota-policies.test.mjs
tests/unit/observability-quota-usage-view.test.mjs
tests/unit/observability-threshold-alerts.test.mjs
tests/unit/observability-usage-consumption.test.mjs
tests/unit/oidc-app-client-redirect-allowlist.test.mjs
tests/unit/postgres-admin.test.mjs
tests/unit/postgres-data-api.test.mjs
tests/unit/postgres-ddl-table-isolation.test.mjs
tests/unit/public-api.test.mjs
tests/unit/quality-gates.test.mjs
tests/unit/quota-effective-limits.test.mjs
tests/unit/quota.test.mjs
tests/unit/realm-brute-force-protection.test.mjs
tests/unit/realtime-gateway/audit-publisher.test.mjs
tests/unit/realtime-gateway/filter-evaluator.test.mjs
tests/unit/realtime-gateway/filter-parser.test.mjs
tests/unit/realtime-gateway/scope-checker.test.mjs
tests/unit/realtime-gateway/tenant-workspace-guard.test.mjs
tests/unit/realtime-gateway/token-validator.test.mjs
tests/unit/realtime/EventFilter.test.mjs
tests/unit/realtime/Subscription.test.mjs
tests/unit/realtime/SubscriptionQuota.test.mjs
tests/unit/realtime/helpers/client-buffer.test.mjs
tests/unit/realtime/helpers/poller.test.mjs
tests/unit/reconcile-operations.test.mjs
tests/unit/repository-layout.test.mjs
tests/unit/retry-attempt.test.mjs
tests/unit/retry-override.test.mjs
tests/unit/retry-semantics-profile.test.mjs
tests/unit/route-catalog-reconciliation.test.mjs
tests/unit/route-invoke-security.test.mjs
tests/unit/runtime-cleanup-repository.test.mjs
tests/unit/runtime-teardown-coordinator.test.mjs
tests/unit/sa-revocation-check.test.mjs
tests/unit/service-map.test.mjs
tests/unit/staging-backup-evidence-contract.test.mjs
tests/unit/storage-access-policy.test.mjs
tests/unit/storage-admin-audit-routes.test.mjs
tests/unit/storage-admin.test.mjs
tests/unit/storage-audit-ops.test.mjs
tests/unit/storage-capacity-quotas.test.mjs
tests/unit/storage-credential-expiry-sweep-iam.test.mjs
tests/unit/storage-default-provider-type.test.mjs
tests/unit/storage-event-notifications.test.mjs
tests/unit/storage-handlers-xml-parsing.test.mjs
tests/unit/storage-identity-runtime.test.mjs
tests/unit/storage-import-export.test.mjs
tests/unit/storage-multipart-presigned.test.mjs
tests/unit/storage-usage-reporting.test.mjs
tests/unit/storage-verification.test.mjs
tests/unit/tenant-bootstrap.test.mjs
tests/unit/tenant-console-auth.test.mjs
tests/unit/tenant-data-api-audience.test.mjs
tests/unit/tenant-invitation-lifecycle.test.mjs
tests/unit/tenant-invitation-migration.test.mjs
tests/unit/tenant-invitation-route.test.mjs
tests/unit/tenant-management.test.mjs
tests/unit/tenant-provisioning-audience.test.mjs
tests/unit/tenant-purge-cascade.test.mjs
tests/unit/tenant-purge-completeness.test.mjs
tests/unit/tenant-purge-handler.test.mjs
tests/unit/tenant-purge-response.test.mjs
tests/unit/tenant-rls-context.test.mjs
tests/unit/tenant-role-authorization-http.test.mjs
tests/unit/tenant-role-runtime.test.mjs
tests/unit/tenant-role-storage.test.mjs
tests/unit/tenant-rotation-policy.test.mjs
tests/unit/tenant-social-provider.test.mjs
tests/unit/testing-strategy.test.mjs
tests/unit/vector-capability-image.test.mjs
tests/unit/vector-capability-unavailable.test.mjs
tests/unit/web-console-static-server.test.mjs
tests/unit/webhook-audit.test.mjs
tests/unit/webhook-database-principals.test.mjs
tests/unit/webhook-delivery.test.mjs
tests/unit/webhook-key-cli.test.mjs
tests/unit/webhook-key-startup.test.mjs
tests/unit/webhook-lifecycle-audit.test.mjs
tests/unit/webhook-master-key.test.mjs
tests/unit/webhook-quota.test.mjs
tests/unit/webhook-retry-policy.test.mjs
tests/unit/webhook-signing.test.mjs
tests/unit/webhook-subscription.test.mjs
tests/unit/wf-con-001-user-approval.test.mjs
tests/unit/wf-con-002-tenant-provisioning.test.mjs
tests/unit/wf-con-003-workspace-creation.test.mjs
tests/unit/wf-con-004-credential-generation.test.mjs
tests/unit/wf-con-004-grace-period-rotation.test.mjs
tests/unit/wf-con-006-service-account.test.mjs
tests/unit/wired-routes-http.test.mjs
tests/unit/workflow-idempotency-store.test.mjs
tests/unit/workflow-job-status.test.mjs
tests/unit/workflow-status-runtime.test.mjs
tests/unit/workspace-capability-catalog-action.test.mjs
tests/unit/workspace-consumption-route.test.mjs
tests/unit/workspace-dsn-resolver.test.mjs
tests/unit/workspace-iam-client-create.test.mjs
tests/unit/workspace-iam-client-route.test.mjs
tests/unit/workspace-list-tenant-scope.test.mjs
tests/unit/workspace-management.test.mjs
tests/unit/workspace-model-authz.test.mjs
tests/unit/workspace-realtime-config-route.test.mjs
tests/unit/workspace-secret-delete-contract.test.mjs
tests/unit/workspace-secret-purge.test.mjs
tests/unit/workspace-secret-role-gate.test.mjs
tests/workflows/workflow-audit-schema.test.mjs
tests/workflows/workflow-audit.test.mjs
tools/falcone-cli/bin/falcone.mjs
tools/falcone-cli/package.json
tools/falcone-cli/src/cli.mjs
tools/falcone-cli/src/cli.test.mjs
tools/falcone-cli/src/context.mjs
tools/falcone-cli/src/context.test.mjs
tools/falcone-cli/src/mcp/deploy.mjs
tools/falcone-cli/src/mcp/deploy.test.mjs
tools/falcone-cli/src/mcp/dev.mjs
tools/falcone-cli/src/mcp/dev.test.mjs
tools/falcone-cli/src/mcp/scaffold.mjs
tools/falcone-cli/src/mcp/scaffold.test.mjs
tools/migration/ROLLBACK.md
tools/migration/RUNBOOK.md
tools/migration/_s3lib.sh
tools/migration/compare-snapshots.sh
tools/migration/compat-gate.sh
tools/migration/ferretdb/ROLLBACK-RUNBOOK.md
tools/migration/ferretdb/RUNBOOK.md
tools/migration/ferretdb/bulk-copy.sh
tools/migration/ferretdb/compare-snapshots.sh
tools/migration/ferretdb/delta-export.sh
tools/migration/ferretdb/export-indexes.sh
tools/migration/ferretdb/migrate.sh
tools/migration/ferretdb/preflight.sh
tools/migration/ferretdb/recreate-indexes.sh
tools/migration/ferretdb/rollback-delta-back.sh
tools/migration/ferretdb/rollback-mongo-check.mjs
tools/migration/ferretdb/rollback-validate.sh
tools/migration/ferretdb/runbook-results/testenv-compose-20260616T054329Z.md
tools/migration/ferretdb/snapshot.sh
tools/migration/ferretdb/upsert.sh
tools/migration/migrate.sh
tools/migration/runbook-results/docker-local-20260614T111139Z.md
tools/migration/runbook-results/kind-decommission-20260614T133327Z.md
tools/migration/runbook-results/kind-rollback-gate-20260614T125657Z.md
tools/migration/snapshot.sh
turbo.json
```
