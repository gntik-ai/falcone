## 1. Reproduce / encode the contract

- [x] 1.1 Confirm root cause on `main` (HEAD `cdb13623`): `fn-handlers.mjs::ownedWorkspace` checks
  tenant only (cross-tenant → 404) and `secretSet`/`secretReplace`/`secretDelete` write with no role
  check; every other privileged CP write gates with `canManageTenant`/`canManageTenantId`.
- [x] 1.2 Add `tests/unit/workspace-secret-role-gate.test.mjs` driving `FN_HANDLERS` with DI seams
  (`ctx.store` + a recording fake `ctx.vaultStore`) encoding the acceptance criteria:
  - viewer & developer (`actorType: 'tenant_member'`) → secretSet/secretReplace/secretDelete each
    `403` AND the fake vault `set`/`replace`/`delete` were NEVER called (calls array empty).
  - `tenant_owner` & `superadmin` → secretSet `201` (set called), secretReplace `200`, secretDelete
    `200` (legit behavior preserved).
  - viewer → secretList & secretGet still `200` (reads not gated).
  - cross-tenant member (`tenantId` ≠ ws tenant) → secretSet `404 WORKSPACE_NOT_FOUND` (404 > 403),
    vault not called.

## 2. Fix (minimal, consistent with the rest of the CP)

- [x] 2.1 `import { canManageTenant } from './tenant-scope.mjs';` in `fn-handlers.mjs`.
- [x] 2.2 In `secretSet`, `secretReplace`, `secretDelete` ONLY, AFTER the
  `const ws = await ownedWorkspace(...)` / `if (!ws) return err(404, 'WORKSPACE_NOT_FOUND', ...)`
  lines and BEFORE any write/validation side effect, add:
  `if (!canManageTenant(ctx.identity, ws.tenant_id)) return err(403, 'FORBIDDEN', 'requires superadmin or tenant owner/admin');`
  (same 403 string as `b-handlers.mjs` for parity).
- [x] 2.3 Do NOT modify `secretList`, `secretGet`, `ownedWorkspace`, or any other handler.

## 3. Wire / frontend / docs

- [x] 3.1 No OpenAPI/contract/SDK change (success shapes unchanged, `403` is a standard authz
  outcome) — confirm no `*.openapi.json` or generated file is edited.
- [x] 3.2 `apps/web-console/src/lib/workspace-secrets-access.ts` — comment-only edit stating per-secret
  mutate authority is now server-enforced by the workspace tenant role gate (`canManageTenant`) in
  addition to the `ownedWorkspace` tenant/isolation check (no TypeScript logic change).
- [x] 3.3 `docs/reference/architecture/workspace-secrets-console.md` — add "Role authorization on
  writes" documenting the gate, production parity, 404-before-403 ordering, and reads not gated.
- [x] 3.4 Spec delta: `openspec/changes/fix-798-workspace-secret-role-gate/specs/secrets/spec.md` —
  `## ADDED Requirements` (NOT MODIFIED) under the real `secrets` capability, one new requirement
  ("Workspace secret mutations require an admin tenant role") with WHEN/THEN scenarios matching the
  acceptance criteria. It is a DISTINCT authorization concern from the existing storage requirement
  ("Workspace secrets are stored in and consumed from Vault"), so ADD rather than MODIFY (cleaner and
  avoids the archive-sync MODIFIED-block hazard; mirrors sibling fix-672/fix-666 new-requirement
  changes).

## 4. Design decision recorded

- [x] 4.1 Record in `proposal.md` (and here): the declarative route-catalog `audiences` are enforced
  nowhere in the CP; we deliberately reuse the coarse `canManageTenant` tenant-admin gate for
  consistency/minimal regression. Finer per-workspace-role audiences across the CP are a pre-existing
  broader gap (#761/#773), out of scope here.
- [x] 4.2 Record in `proposal.md` the realm-bound safety note: `canManageTenant` requires
  `identity.tenantId === ws.tenant_id` for owner/admin; the verified tenant id is realm-bound (not
  body/claim-controlled), so even a forged `claims.actor_type` cannot grant cross-tenant write
  authority — a tenant-A token can only ever manage tenant A.

## 5. Verify

- [ ] 5.1 CI runs `pnpm test:unit` (`node --test tests/unit/*.test.mjs`, `ci.yml`) — the new test is
  the executed regression slice. (Local Node exec is permission-gated in this environment; CI is the
  regression gate.)
- [ ] 5.2 Confirm `tests/blackbox/console-workspace-secrets.test.mjs` still passes (its default ctx
  identity is `tenant_owner`, admitted by `canManageTenant`, so create/replace/delete remain green).
- [ ] 5.3 `openspec validate fix-798-workspace-secret-role-gate --strict` (if the CLI is available).
