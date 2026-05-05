# OpenSpec conventions — In Falcone

## Capability boundaries

Capabilities follow the **route family + bounded context** rule:

- A capability owns one or more `/v1/*` route families.
- A capability owns one or more bounded contexts in the control plane.
- A capability owns the part of `apps/web-console` that consumes its API.
- A capability owns its slice of `services/internal-contracts`.

Capabilities do NOT own:

- Helm chart values (those belong to `deployment-and-operations`).
- The audit pipeline (that belongs to `observability-and-audit`).
- The gateway itself (that belongs to `gateway-and-public-surface`).

When a capability needs to interact with one of those cross-cutting
concerns, it does so via documented contracts, not by editing them
directly.

## Spec file structure

Every `openspec/specs/<capability>/spec.md` contains exactly these
sections, in this order:

1. `# <Capability name>` — H1 title.
2. `## Purpose` — One paragraph, max 5 sentences.
3. `## Surfaces` — Bullet list of:
   - Public REST endpoints owned (route family + family file path)
   - Frontend pages owned (component name + route path)
   - Internal contracts owned (path)
   - Kafka topics emitted/consumed
   - PostgreSQL tables owned
4. `## Behaviour` — Numbered requirements `### REQ-<CAP>-<NN>`.
   Each requirement has: `Description`, `Acceptance criteria`, `Trace`
   (back to `docs/tasks/us-*.md` and ADRs).
5. `## Cross-capability dependencies` — Bullet list naming other
   capabilities consumed.
6. `## Out of scope` — Bullet list of things this capability does NOT do.
7. `## Open questions` — Unresolved decisions, each linked to a change
   proposal slug if one exists.

## Requirement IDs

`REQ-<CAPABILITY-PREFIX>-<NN>` where:

- `IAM` — identity-and-access
- `TEN` — tenant-lifecycle
- `WSP` — workspace-management
- `DAT` — data-services
- `FN`  — functions-runtime
- `RTM` — realtime-and-events
- `OBS` — observability-and-audit
- `SEC` — secret-management
- `QTA` — quota-and-billing
- `BCK` — backup-and-restore
- `GW`  — gateway-and-public-surface
- `OPS` — deployment-and-operations

Add new prefixes only when a new top-level capability is introduced.

## Change proposal naming

`openspec/changes/<verb>-<noun-phrase>/`

Verbs: `add`, `remove`, `harden`, `migrate`, `consolidate`, `split`,
`rename`, `deprecate`. Noun phrases are kebab-case and describe the
*change*, not the *capability*.

## Task IDs

`T<NN>` numbered globally within the change. Do not reuse numbers.
The first task is always `T01: Confirm baseline green`.

## Trace links

Every spec requirement links back to:

- the legacy SpecKit user story (`docs/tasks/us-XXX.md`) if relevant;
- the ADR that established the architectural decision;
- the OpenAPI family file if it concerns a public endpoint.

Use repository-relative paths so links survive forks.

## Validation

The capability specs are validated by `openspec validate --all --strict`.
A future repository validator (`validate:openspec-coverage`) will check
that every `/v1/*` route maps to exactly one capability and that every
page in `apps/web-console/src/pages/` maps to exactly one capability.

## Commits and PRs

- Every commit on a feature branch references the change proposal slug:
  `feat(add-frontend-completion-pages): T03 add ProfilePage`.
- The PR template requires checking off the `tasks.md` entries.
- Squash-merge is preferred for change-proposal branches; the squash
  message is the proposal's first paragraph.

## Archival

When a change proposal is fully implemented:

1. Move `openspec/changes/<change>/` to
   `openspec/archive/<YYYY-MM>/<change>/`.
2. Update affected capability specs in the same commit.
3. Tag the commit `openspec-archive/<change-slug>`.

Archived proposals remain in the repository — they are the audit trail.
