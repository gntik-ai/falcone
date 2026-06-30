## T01: Confirm the baseline failure

- [x] Record the confirmed pre-fix verifier evidence: on `origin/main` `8291f56f`,
  `definitionToNodes({})` throws `Cannot read properties of undefined (reading 'forEach')`.
- [x] Confirm live verification is not part of this local fix because the available kube context was
  safety-blocked as non-kind in the verifier report.

## T02: Implement the minimal projection fix

- [x] Update `apps/web-console/src/components/flows/flowGraphModel.ts` so
  `definitionToNodes`, `definitionToEdges`, and `autoLayout` treat missing node arrays as empty.
- [x] Update `apps/web-console/src/pages/ConsoleFlowDesignerPage.tsx` so loaded records and the base
  save projection use `normalizeDefinition`.

## T03: Add regression coverage

- [x] Extend `apps/web-console/src/__tests__/FlowGraphModel.test.tsx` with the issue scenario:
  `definitionToNodes({})`, `definitionToEdges({})`, and `autoLayout(undefined)` return empty
  structures without throwing.

## T04: Documentation and OpenSpec

- [x] Add this OpenSpec change under
  `openspec/changes/fix-791-flow-designer-empty-definition/`.
- [x] Update the flows architecture documentation with the empty-draft projection boundary.

## T05: Verification

- [x] Run the focused web-console Vitest file for `FlowGraphModel`.
- [x] Run `openspec validate fix-791-flow-designer-empty-definition --strict`.
- [x] Run public API validation/generation checks and confirm no contract diff.
- [x] Review the final diff and commit only issue-scoped files on
  `fix/791-flow-designer-empty-definition`.
