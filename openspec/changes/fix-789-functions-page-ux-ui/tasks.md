## 1. Reproduce / encode the issue

- [x] 1.1 Parse issue #789 acceptance criteria:
  - Requirement: Functions page meets the console's UX/visual bar.
  - Scenario: tenant owner edits code/payload, deploys, invokes, and inspects
    results/logs/versions; editors are monospace, outcomes use `Alert`, statuses are
    color-encoded, tabs are keyboard-accessible, and the working deploy path is primary.
- [x] 1.2 Confirm the root in `apps/web-console/src/pages/ConsoleFunctionsPage.tsx`.
- [x] 1.3 Add focused tests for monospace/spellcheck-off editors, tablist keyboard semantics,
  Alert-routed outcomes, status tone classes, primary deploy path, no leaking capability badge,
  and invoke-to-activation/result behavior.

## 2. Implement the frontend fix

- [x] 2.1 Replace raw code/JSON textareas with `Textarea` surfaces using monospace typography,
  disabled spellcheck, and `parseJsonObject`/`prettyJson` for JSON handling.
- [x] 2.2 Render logs, result payloads, and inline invocation payloads through one shared console
  block.
- [x] 2.3 Render errors, partial-result warnings, rollback feedback, invoke feedback, and deploy
  feedback through `Alert`.
- [x] 2.4 Replace action/detail status badges with severity-encoded tone classes.
- [x] 2.5 Replace the detail button row with an accessible tablist and roving keyboard focus.
- [x] 2.6 Remove the wizard capability gate from this page and make inline deploy the coherent
  primary action.
- [x] 2.7 Refetch activations after invoke, select the linked activation, switch to Activations,
  and render logs/result for the selected activation.

## 3. Docs / OpenSpec / wire

- [x] 3.1 Materialize this OpenSpec change under
  `openspec/changes/fix-789-functions-page-ux-ui/`.
- [x] 3.2 Add architecture docs for the Functions page UX/UI contract.
- [x] 3.3 Leave backend, OpenAPI/AsyncAPI, generated clients, shared types, auth claims, and
  real-time event shapes unchanged because no wire contract changes are required.

## 4. Verify

- [x] 4.1 Run focused `ConsoleFunctionsPage` Vitest coverage.
- [x] 4.2 Run `openspec validate fix-789-functions-page-ux-ui --strict`.
- [x] 4.3 Run `npm run generate:public-api` and confirm no tracked generated drift.
- [x] 4.4 Run `git diff --check`.
