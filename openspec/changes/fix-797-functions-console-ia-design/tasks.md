## 1. Reproduce / encode the issue

- [x] 1.1 Parse issue #797 acceptance criteria:
  - Requirement: group and purpose-label Functions navigation destinations, keep page titles in
    agreement with routing labels, and render the Data: Functions screen with console
    design-system primitives and explicit states.
  - Scenario 1: opening the console sidebar shows grouped, purpose-labeled function destinations,
    not ambiguous flat Functions entries, and the active function page title matches its route
    label.
  - Scenario 2: rendering Data: Functions uses shared cards/primitives with consistent feedback and
    empty/loading states.
- [x] 1.2 Confirm the root in `ConsoleShellLayout.tsx`, `ConsoleFunctionsPage.tsx`,
  `ConsoleFunctionsDataPage.tsx`, and `FunctionsConsole.tsx`.
- [x] 1.3 Add focused tests for grouped navigation/route-title agreement and quick-deploy state
  rendering.

## 2. Implement the frontend fix

- [x] 2.1 Add sidebar grouping metadata/rendering while preserving existing superadmin and
  workspace-secret visibility gates.
- [x] 2.2 Co-locate and purpose-label the three Functions destinations.
- [x] 2.3 Align `ConsoleFunctionRegistryPage`, `ConsoleFunctionsPage`, and
  `ConsoleFunctionsDataPage` titles with the new route labels.
- [x] 2.4 Render the Data: Functions no-tenant/no-workspace guards with `ConsolePageState`.
- [x] 2.5 Update `FunctionsConsole` loading, empty, result, activation-loading, and no-activation
  states to use `ConsolePageState`, while preserving existing deploy/invoke/activation behavior.

## 3. Docs / OpenSpec / wire

- [x] 3.1 Materialize this OpenSpec change under
  `openspec/changes/fix-797-functions-console-ia-design/`.
- [x] 3.2 Add architecture docs for the Functions console IA and quick-deploy design contract.
- [x] 3.3 Leave backend, OpenAPI/AsyncAPI, generated clients, shared types, auth claims, and
  real-time event shapes unchanged because no wire contract changes are required.

## 4. Verify

- [x] 4.1 Run focused web-console Vitest for the modified shell/functions tests.
- [x] 4.2 Run `openspec validate fix-797-functions-console-ia-design --strict`.
- [x] 4.3 Run `npm run generate:public-api` and confirm no tracked generated drift.
- [x] 4.4 Run `git diff --check`.
