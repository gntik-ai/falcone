## 1. Reproduce / encode the contract

- [x] 1.1 Confirm the issue from source trace: executor provider/MCP/events writes and kind
  storage/Kafka writes checked tenant membership/ownership but not the caller's tenant role.
- [x] 1.2 Add focused executor tests covering `tenant_viewer` / `tenant_developer` denial for LLM,
  embedding, embedding mapping, MCP, and Events write paths, with no side-effect calls.
- [x] 1.3 Add focused kind handler tests covering storage bucket/credential/object writes and Kafka
  topic/publish writes for denied non-admin roles and allowed admin roles.
- [x] 1.4 Add frontend tests verifying Events create/publish controls are not offered to non-admin
  roles.

## 2. Fix

- [x] 2.1 Add a central executor structural-write route gate that reuses the existing non-write role
  helper and runs before handlers/executors.
- [x] 2.1a Tighten the executor gate to require a positive write-capable admin role, denying API-key
  credentials and empty/missing-role JWT/header identities before structural side effects.
- [x] 2.2 Propagate verified `workspaceIds` into identities and enforce them for workspace-scoped
  structural writes.
- [x] 2.3 Reject unknown executor workspaces for structural writes before any executor side effect.
- [x] 2.4 Add kind storage and Kafka admin-role gates after ownership/no-leak checks and before
  external store/broker/S3 side effects.
- [x] 2.5 Hide Events console create/publish actions for non-admin roles without redesigning the page.

## 3. Docs / contract

- [x] 3.1 Add the OpenSpec change under
  `openspec/changes/fix-773-structural-write-role-gates/`.
- [x] 3.2 Add a concise documentation reference for structural-write role gates.
- [x] 3.3 Confirm no OpenAPI/AsyncAPI/generated-client changes are needed because the wire shape is
  unchanged.

## 4. Verify

- [x] 4.1 Run focused executor/kind Node tests.
- [x] 4.2 Run focused web-console tests.
- [x] 4.3 Run `openspec validate fix-773-structural-write-role-gates --strict`.
- [x] 4.4 Run public API/codegen check and confirm no generated diff, if the repo command is
  available.
- [x] 4.5 Run `git diff --check`.
