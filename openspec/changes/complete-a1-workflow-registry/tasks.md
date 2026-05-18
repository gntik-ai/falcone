## 1. Failing tests proving the bugs

- [ ] 1.1 [test] Add `apps/control-plane/src/workflows/workflow-registry.test.mjs`
      with a case that dispatches WF-CON-005 and asserts the response shape is
      identical to a `definition.provisional === true` dispatch, proving B2
      from `workflows/index.mjs:23-25` vs `saga-engine.mjs:57-59`.
- [ ] 1.2 [test] Add a case that loads `saga-definitions.mjs` and asserts every
      step key referenced for WF-CON-002/003/004/006 exists in the public
      capability catalogue, proving G1 from `saga-definitions.mjs:50-87`.
- [ ] 1.3 [test] Add a case that registers a fake workflow module without a
      `default` export and asserts the dispatcher throws
      `WorkflowHandlerInvalidError`, proving G9 from `workflows/index.mjs:29`.

## 2. Implementation

- [ ] 2.1 [impl] Collapse the two not-implemented shapes to one envelope
      `{ status: 'not-implemented', workflowId }` at both
      `workflows/index.mjs:23-25` and `saga-engine.mjs:57-59`.
- [ ] 2.2 [impl] Add `apps/control-plane/src/workflows/wf-con-005-*.mjs`
      registered in `workflows/index.mjs` — implementing the catalogue contract
      or marking the saga `provisional` so the canonical envelope is returned.
- [ ] 2.3 [spec] Add `scripts/validate-workflow-step-keys.mjs` that loads
      `saga-definitions.mjs` and the public catalogue and fails on any step-key
      drift; wire it into `package.json`'s `validate` script.
- [ ] 2.4 [fix] Tighten `workflows/index.mjs:29` to assert the loaded module's
      `default` is a function; throw `WorkflowHandlerInvalidError` otherwise.

## 3. Docs and validation

- [ ] 3.1 [docs] Document the canonical not-implemented envelope in
      `apps/control-plane/src/README.md` and the step-key validator in
      `scripts/README.md`.
- [ ] 3.2 [test] Run targeted tests +
      `openspec validate complete-a1-workflow-registry --strict`; both green.
