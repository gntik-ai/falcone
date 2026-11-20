# Web console retirement handoff / PR body

Move the serving configuration to `apps/web-console-next`, remove the unserved legacy app,
and repoint image builds, catalogue validation, repository tooling and consumers. The image
identity, build arguments, UID 1000, port 3000, command, HTTP routing and headers are preserved.
The server file is byte-identical to source base `69296937330b61be2bbf2c7267520196499fc038`.

## Release coupling

Ship this source revision and the companion chart dockerfile-path change together. An
OpenShift build's `global.openshiftBuild.git.ref` must name a source revision containing
`apps/web-console-next/Dockerfile`. Rollback reverts both repository changes; image identities,
digests, the cutover evidence and External Secrets/OpenBao wiring are unchanged. No deployment
or staging verification was performed by the source maker.

## Test and check disposition

The table lists every removed legacy test file, relative to the retired app root at the
immutable base above. Next page tests and parity specs cover the served routes. Legacy-only
backup/config-export/API-reference/privilege/scope components had no route in the pre-removal
router and no served counterpart; their component checks retire with that unreachable code.
`tests/router.test.tsx` retains the complete frozen public route set and `tests/notFound.test.tsx`
retains catch-all behavior. No shipped page is removed by this change.

`lint:snippets` is retained: its realtime catalogue membership checks now read both next locale
catalogues, and its syntax/placeholder checks read the functions, PostgreSQL and storage
page snippet modules. The legacy shared-catalogue file check is retired because that catalogue
is removed. The existing standalone realtime syntax and guide checks remain.

The dependency override regression stays at the workspace boundary: `glob@10.5.0` is now an
explicit root test dependency instead of being reachable only through the removed legacy
coverage-v8 dependency. Its minimatch 9 / patched brace-expansion 2 assertions are unchanged.
Hermes regenerated `pnpm-lock.yaml` in dependency-resolution commit `be31c4fa`; the legacy
importer is absent and the root glob dependency is resolved. No lockfile was hand-edited.
The sandbox offline frozen install is blocked by pnpm subprocess `EPERM`; CI must verify it
with the repository-pinned pnpm 10.0.0 (the sandbox executable reports 9.12.3).

| Deleted legacy test (relative path) | Next counterpart | Disposition |
| --- | --- | --- |
| `e2e/workspace-docs.spec.ts` | `apps/web-console-next/tests/consoleDocs.test.tsx` | Served page, shared contract or interaction coverage. |
| `src/__tests__/BackupScopeMatrix.test.tsx` | `apps/web-console-next/tests/router.test.tsx` | Unrouted legacy-only surface; route-set and catch-all checks remain. |
| `src/__tests__/ConfigExportDomainSelector.test.tsx` | `apps/web-console-next/tests/router.test.tsx` | Unrouted legacy-only surface; route-set and catch-all checks remain. |
| `src/__tests__/ConfigExportResultPanel.test.tsx` | `apps/web-console-next/tests/router.test.tsx` | Unrouted legacy-only surface; route-set and catch-all checks remain. |
| `src/__tests__/ConsoleBackupScopePage.test.tsx` | `apps/web-console-next/tests/router.test.tsx` | Unrouted legacy-only surface; route-set and catch-all checks remain. |
| `src/__tests__/ConsoleDocsPage.test.tsx` | `apps/web-console-next/tests/consoleDocs.test.tsx` | Served page, shared contract or interaction coverage. |
| `src/__tests__/ConsoleTenantConfigExportPage.test.tsx` | `apps/web-console-next/tests/router.test.tsx` | Unrouted legacy-only surface; route-set and catch-all checks remain. |
| `src/__tests__/ConsoleTenantConfigPreflightPage.test.tsx` | `apps/web-console-next/tests/router.test.tsx` | Unrouted legacy-only surface; route-set and catch-all checks remain. |
| `src/__tests__/ConsoleTenantConfigReprovisionPage.test.tsx` | `apps/web-console-next/tests/router.test.tsx` | Unrouted legacy-only surface; route-set and catch-all checks remain. |
| `src/__tests__/FlowConnectionRules.test.ts` | `apps/web-console-next/tests/consoleFlowDesigner.test.tsx` | Served page, shared contract or interaction coverage. |
| `src/__tests__/FlowGraphModel.test.tsx` | `apps/web-console-next/tests/consoleFlowDesigner.test.tsx` | Served page, shared contract or interaction coverage. |
| `src/__tests__/FlowSemanticMarkers.test.ts` | `apps/web-console-next/tests/consoleFlowDesigner.test.tsx` | Served page, shared contract or interaction coverage. |
| `src/__tests__/FlowSemanticValidation.test.ts` | `apps/web-console-next/tests/consoleFlowDesigner.test.tsx` | Served page, shared contract or interaction coverage. |
| `src/__tests__/FlowViewSwitcher.test.tsx` | `apps/web-console-next/tests/consoleFlowDesigner.test.tsx` | Served page, shared contract or interaction coverage. |
| `src/__tests__/FlowViewSync.test.ts` | `apps/web-console-next/tests/consoleFlowDesigner.test.tsx` | Served page, shared contract or interaction coverage. |
| `src/__tests__/FlowYamlEditor.test.tsx` | `apps/web-console-next/tests/consoleFlowDesigner.test.tsx` | Served page, shared contract or interaction coverage. |
| `src/__tests__/FlowYamlRoundTrip.test.ts` | `apps/web-console-next/tests/consoleFlowDesigner.test.tsx` | Served page, shared contract or interaction coverage. |
| `src/__tests__/PostgresDataEditor.test.tsx` | `apps/web-console-next/tests/consolePostgresData.test.tsx` | Served page, shared contract or interaction coverage. |
| `src/__tests__/WorkspaceDocNotes.test.tsx` | `apps/web-console-next/tests/consoleDocs.test.tsx` | Served page, shared contract or interaction coverage. |
| `src/__tests__/WorkspaceDocSections.test.tsx` | `apps/web-console-next/tests/consoleDocs.test.tsx` | Served page, shared contract or interaction coverage. |
| `src/actions/secretRotationActions.test.ts` | `apps/web-console-next/tests/consoleSecretRotation.test.tsx` | Served page, shared contract or interaction coverage. |
| `src/components/ConfigIdentifierMapEditor.test.tsx` | `apps/web-console-next/tests/router.test.tsx` | Unrouted legacy-only surface; route-set and catch-all checks remain. |
| `src/components/RouteErrorBoundary.test.tsx` | `apps/web-console-next/tests/welcome-chunk-error.test.tsx` | Served page, shared contract or interaction coverage. |
| `src/components/auth/ProtectedRoute.session-invalidation.test.tsx` | `apps/web-console-next/tests/auth-guard.test.tsx` | Served page, shared contract or interaction coverage. |
| `src/components/auth/ProtectedRoute.test.tsx` | `apps/web-console-next/tests/auth-guard.test.tsx` | Served page, shared contract or interaction coverage. |
| `src/components/backup/__tests__/RestoreConfirmationDialog.test.tsx` | `apps/web-console-next/tests/router.test.tsx` | Unrouted legacy-only restore surface retires; route-set and catch-all checks remain. |
| `src/components/backup/__tests__/RestoreSimulationDialog.test.tsx` | `apps/web-console-next/tests/router.test.tsx` | Unrouted legacy-only simulation surface retires; route-set and catch-all checks remain. |
| `src/components/backup/__tests__/TenantNameInput.test.tsx` | `apps/web-console-next/tests/router.test.tsx` | Unrouted legacy-only surface; route-set and catch-all checks remain. |
| `src/components/console/ActiveOperationsIndicator.test.tsx` | `apps/web-console-next/tests/consoleOperations.test.tsx` | Served page, shared contract or interaction coverage. |
| `src/components/console/BackupScopeLegend.test.tsx` | `apps/web-console-next/tests/router.test.tsx` | Unrouted legacy-only surface; route-set and catch-all checks remain. |
| `src/components/console/CapabilityGate.test.tsx` | `apps/web-console-next/tests/capabilities.test.tsx` | Served page, shared contract or interaction coverage. |
| `src/components/console/CapabilityStatusGrid.test.tsx` | `apps/web-console-next/tests/capabilities.test.tsx` | Served page, shared contract or interaction coverage. |
| `src/components/console/ConnectionSnippets.test.tsx` | `apps/web-console-next/tests/consoleStorage.test.tsx` | Served page, shared contract or interaction coverage. |
| `src/components/console/ConsoleCredentialStatusBadge.test.tsx` | `apps/web-console-next/tests/consoleServiceAccounts.test.tsx` | Served page, shared contract or interaction coverage. |
| `src/components/console/ConsoleInvitationList.test.tsx` | `apps/web-console-next/tests/welcome.test.tsx` | Served page, shared contract or interaction coverage. |
| `src/components/console/ConsoleMetricDimensionRow.test.tsx` | `apps/web-console-next/tests/consoleObservability.test.tsx` | Served page, shared contract or interaction coverage. |
| `src/components/console/ConsolePageState.test.tsx` | `apps/web-console-next/tests/states.test.tsx` | Served page, shared contract or interaction coverage. |
| `src/components/console/ConsoleQuotaPostureBadge.test.tsx` | `apps/web-console-next/tests/consoleQuotas.test.tsx` | Served page, shared contract or interaction coverage. |
| `src/components/console/ConsoleTimeRangeSelector.test.tsx` | `apps/web-console-next/tests/consoleObservability.test.tsx` | Served page, shared contract or interaction coverage. |
| `src/components/console/ConsumptionBar.test.tsx` | `apps/web-console-next/tests/consoleTenantPlan.test.tsx` | Served page, shared contract or interaction coverage. |
| `src/components/console/DestructiveConfirmationDialog.integration.test.tsx` | `apps/web-console-next/tests/consoleServiceAccounts.test.tsx` | Served page, shared contract or interaction coverage. |
| `src/components/console/DestructiveConfirmationDialog.test.tsx` | `apps/web-console-next/tests/consoleServiceAccounts.test.tsx` | Served page, shared contract or interaction coverage. |
| `src/components/console/EventsConsole.test.tsx` | `apps/web-console-next/tests/consoleEventsData.test.tsx` | Served page, shared contract or interaction coverage. |
| `src/components/console/FunctionsConsole.test.tsx` | `apps/web-console-next/tests/consoleFunctionsData.test.tsx` | Served page, shared contract or interaction coverage. |
| `src/components/console/MongoDataEditor.test.tsx` | `apps/web-console-next/tests/consoleMongoData.test.tsx` | Served page, shared contract or interaction coverage. |
| `src/components/console/OpenApiViewer.test.tsx` | `apps/web-console-next/tests/router.test.tsx` | Unrouted legacy-only surface; route-set and catch-all checks remain. |
| `src/components/console/OperationLogEntriesList.test.tsx` | `apps/web-console-next/tests/operationDetail.test.tsx` | Served page, shared contract or interaction coverage. |
| `src/components/console/OperationResultSummary.test.tsx` | `apps/web-console-next/tests/operationDetail.test.tsx` | Served page, shared contract or interaction coverage. |
| `src/components/console/OperationStatusBadge.test.tsx` | `apps/web-console-next/tests/operationDetail.test.tsx` | Served page, shared contract or interaction coverage. |
| `src/components/console/OperationStatusBanner.test.tsx` | `apps/web-console-next/tests/operationDetail.test.tsx` | Served page, shared contract or interaction coverage. |
| `src/components/console/OverrideIndicatorBadge.test.tsx` | `apps/web-console-next/tests/consoleQuotas.test.tsx` | Served page, shared contract or interaction coverage. |
| `src/components/console/PermissionDeniedNotice.test.tsx` | `apps/web-console-next/tests/capabilities.test.tsx` | Served page, shared contract or interaction coverage. |
| `src/components/console/PlanAssignmentDialog.test.tsx` | `apps/web-console-next/tests/consoleTenantPlan.test.tsx` | Served page, shared contract or interaction coverage. |
| `src/components/console/PlanCapabilityBadge.test.tsx` | `apps/web-console-next/tests/consoleTenantPlanOverview.test.tsx` | Served page, shared contract or interaction coverage. |
| `src/components/console/PlanComparisonView.test.tsx` | `apps/web-console-next/tests/consolePlanCatalog.test.tsx` | Served page, shared contract or interaction coverage. |
| `src/components/console/PlanHistoryTable.test.tsx` | `apps/web-console-next/tests/consoleTenantPlan.test.tsx` | Served page, shared contract or interaction coverage. |
| `src/components/console/PlanLimitsTable.test.tsx` | `apps/web-console-next/tests/consolePlanDetail.test.tsx` | Served page, shared contract or interaction coverage. |
| `src/components/console/PlanStatusBadge.test.tsx` | `apps/web-console-next/tests/consolePlanCatalog.test.tsx` | Served page, shared contract or interaction coverage. |
| `src/components/console/PostgresDataEditor.test.tsx` | `apps/web-console-next/tests/consolePostgresData.test.tsx` | Served page, shared contract or interaction coverage. |
| `src/components/console/QuotaAdjustDialog.test.tsx` | `apps/web-console-next/tests/consoleQuotas.test.tsx` | Served page, shared contract or interaction coverage. |
| `src/components/console/QuotaConsumptionTable.test.tsx` | `apps/web-console-next/tests/consoleQuotas.test.tsx` | Served page, shared contract or interaction coverage. |
| `src/components/console/ReadOnlyActionBadge.test.tsx` | `apps/web-console-next/tests/consoleRuntime.test.tsx` | Served page, shared contract or interaction coverage. |
| `src/components/console/RealtimeConsole.test.tsx` | `apps/web-console-next/tests/consoleRealtime.test.tsx` | Served page, shared contract or interaction coverage. |
| `src/components/console/ScopeEnforcementDenialsTable.test.tsx` | `apps/web-console-next/tests/router.test.tsx` | Unrouted legacy-only surface; route-set and catch-all checks remain. |
| `src/components/console/SdkDownloadPanel.test.tsx` | `apps/web-console-next/tests/router.test.tsx` | Unrouted legacy-only surface; route-set and catch-all checks remain. |
| `src/components/console/SpecDownloadButton.test.tsx` | `apps/web-console-next/tests/router.test.tsx` | Unrouted legacy-only surface; route-set and catch-all checks remain. |
| `src/components/console/WorkspaceAllocationSummaryTable.test.tsx` | `apps/web-console-next/tests/consoleTenantAllocationSummary.test.tsx` | Served page, shared contract or interaction coverage. |
| `src/components/console/WorkspaceRequiredState.test.tsx` | `apps/web-console-next/tests/states.test.tsx` | Served page, shared contract or interaction coverage. |
| `src/components/console/hooks/useDestructiveOp.test.ts` | `apps/web-console-next/tests/consoleServiceAccounts.test.tsx` | Served page, shared contract or interaction coverage. |
| `src/components/console/mcp/McpServerConnectPanel.test.tsx` | `apps/web-console-next/tests/consoleMcpServerDetail.test.tsx` | Served page, shared contract or interaction coverage. |
| `src/components/console/mcp/McpServerPlayground.test.tsx` | `apps/web-console-next/tests/consoleMcpServerDetail.test.tsx` | Served page, shared contract or interaction coverage. |
| `src/components/console/snippets/RealtimeSnippetsPanel.test.tsx` | `apps/web-console-next/tests/consoleRealtime-legacy-parity.test.ts` | Served page, shared contract or interaction coverage. |
| `src/components/console/wizards/CreateIamClientWizard.test.tsx` | `apps/web-console-next/tests/consoleAuth-wizard.test.tsx` | Served page, shared contract or interaction coverage. |
| `src/components/console/wizards/CreateTenantWizard.test.tsx` | `apps/web-console-next/tests/consoleTenants.test.tsx` | Served page, shared contract or interaction coverage. |
| `src/components/console/wizards/CreateWorkspaceWizard.test.tsx` | `apps/web-console-next/tests/consoleWorkspaces.test.tsx` | Served page, shared contract or interaction coverage. |
| `src/components/console/wizards/InviteUserWizard.test.tsx` | `apps/web-console-next/tests/consoleMembers.test.tsx` | Served page, shared contract or interaction coverage. |
| `src/components/console/wizards/ProvisionDatabaseWizard.test.tsx` | `apps/web-console-next/tests/consoleWorkspaceDatabase.test.tsx` | Served page, shared contract or interaction coverage. |
| `src/components/console/wizards/PublishFunctionWizard.test.tsx` | `apps/web-console-next/tests/consoleFunctionRegistry.test.tsx` | Served page, shared contract or interaction coverage. |
| `src/components/console/wizards/WizardShell.test.tsx` | `apps/web-console-next/tests/consoleTenants.test.tsx` | Served page, shared contract or interaction coverage. |
| `src/components/flows/FlowPalette.test.tsx` | `apps/web-console-next/tests/consoleFlowDesigner.test.tsx` | Served page, shared contract or interaction coverage. |
| `src/components/flows/FlowProblemsPanel.test.tsx` | `apps/web-console-next/tests/consoleFlowDesigner.test.tsx` | Served page, shared contract or interaction coverage. |
| `src/components/flows/FlowStatusBadge.test.tsx` | `apps/web-console-next/tests/consoleFlows.test.tsx` | Served page, shared contract or interaction coverage. |
| `src/components/flows/NodeStatusBadge.test.tsx` | `apps/web-console-next/tests/consoleFlowRun.test.tsx` | Served page, shared contract or interaction coverage. |
| `src/components/flows/RunActionToolbar.test.tsx` | `apps/web-console-next/tests/consoleFlowRun.test.tsx` | Served page, shared contract or interaction coverage. |
| `src/components/flows/nodes/FlowNodeBadges.test.tsx` | `apps/web-console-next/tests/consoleFlowRun.test.tsx` | Served page, shared contract or interaction coverage. |
| `src/components/flows/nodes/NodeShell.test.tsx` | `apps/web-console-next/tests/consoleFlowDesigner.test.tsx` | Served page, shared contract or interaction coverage. |
| `src/components/flows/panels/NodePropertyPanel.test.tsx` | `apps/web-console-next/tests/consoleFlowDesigner.test.tsx` | Served page, shared contract or interaction coverage. |
| `src/components/ui/card.test.tsx` | `apps/web-console-next/tests/states.test.tsx` | Served page, shared contract or interaction coverage. |
| `src/components/ui/dialog.test.tsx` | `apps/web-console-next/tests/consoleServiceAccounts.test.tsx` | Served page, shared contract or interaction coverage. |
| `src/components/ui/table.test.tsx` | `apps/web-console-next/tests/consolePostgres.test.tsx` | Served page, shared contract or interaction coverage. |
| `src/components/ui/tabs.test.tsx` | `apps/web-console-next/tests/consoleFunctions.test.tsx` | Served page, shared contract or interaction coverage. |
| `src/hooks/useDocumentTitle.test.ts` | `apps/web-console-next/tests/shell.test.tsx` | Served page, shared contract or interaction coverage. |
| `src/layouts/AuthLayout.test.tsx` | `apps/web-console-next/tests/login.test.tsx` | Served page, shared contract or interaction coverage. |
| `src/layouts/ConsoleShellLayout.test.tsx` | `apps/web-console-next/tests/shell-console-shell.test.tsx` | Served page, shared contract or interaction coverage. |
| `src/lib/capabilities/capability-gate-keys.test.ts` | `apps/web-console-next/tests/capabilities.test.tsx` | Served page, shared contract or interaction coverage. |
| `src/lib/console-auth-surface.test.ts` | `apps/web-console-next/tests/login.test.tsx` | Served page, shared contract or interaction coverage. |
| `src/lib/console-auth.test.ts` | `apps/web-console-next/tests/login.test.tsx` | Served page, shared contract or interaction coverage. |
| `src/lib/console-context.test.tsx` | `apps/web-console-next/tests/consoleTenants-context.test.tsx` | Served page, shared contract or interaction coverage. |
| `src/lib/console-errors.test.ts` | `apps/web-console-next/tests/states.test.tsx` | Served page, shared contract or interaction coverage. |
| `src/lib/console-metrics.test.ts` | `apps/web-console-next/tests/consoleObservability.test.tsx` | Served page, shared contract or interaction coverage. |
| `src/lib/console-operations.test.ts` | `apps/web-console-next/tests/consoleOperations.test.tsx` | Served page, shared contract or interaction coverage. |
| `src/lib/console-permissions.test.ts` | `apps/web-console-next/tests/capabilities.test.tsx` | Served page, shared contract or interaction coverage. |
| `src/lib/console-principal.test.ts` | `apps/web-console-next/tests/capabilities.test.tsx` | Served page, shared contract or interaction coverage. |
| `src/lib/console-quotas.test.ts` | `apps/web-console-next/tests/consoleQuotas.test.tsx` | Served page, shared contract or interaction coverage. |
| `src/lib/console-service-accounts.test.ts` | `apps/web-console-next/tests/consoleServiceAccounts.test.tsx` | Served page, shared contract or interaction coverage. |
| `src/lib/console-session.test.ts` | `apps/web-console-next/tests/auth-guard.test.tsx` | Served page, shared contract or interaction coverage. |
| `src/lib/console-workspace-docs.test.ts` | `apps/web-console-next/tests/consoleDocs.test.tsx` | Served page, shared contract or interaction coverage. |
| `src/lib/destructive-ops.test.ts` | `apps/web-console-next/tests/consoleServiceAccounts.test.tsx` | Served page, shared contract or interaction coverage. |
| `src/lib/editor-ux.test.ts` | `apps/web-console-next/tests/consoleFunctionsData.test.tsx` | Served page, shared contract or interaction coverage. |
| `src/lib/flows/validation-errors.test.ts` | `apps/web-console-next/tests/consoleFlowDesigner.test.tsx` | Served page, shared contract or interaction coverage. |
| `src/lib/format.test.ts` | `apps/web-console-next/tests/format.test.ts` | Served page, shared contract or interaction coverage. |
| `src/lib/hooks/use-capability-gate.test.ts` | `apps/web-console-next/tests/capabilities.test.tsx` | Served page, shared contract or interaction coverage. |
| `src/lib/hooks/use-flow-execution.test.tsx` | `apps/web-console-next/tests/consoleFlowRun-stream.test.tsx` | Served page, shared contract or interaction coverage. |
| `src/lib/hooks/use-reconnect-state-sync.tenant-isolation.test.ts` | `apps/web-console-next/tests/consoleOperations.test.tsx` | Served page, shared contract or interaction coverage. |
| `src/lib/hooks/use-reconnect-state-sync.test.ts` | `apps/web-console-next/tests/consoleOperations.test.tsx` | Served page, shared contract or interaction coverage. |
| `src/lib/mcp/mcp-api.test.ts` | `apps/web-console-next/tests/consoleMcpServerDetail.test.tsx` | Served page, shared contract or interaction coverage. |
| `src/lib/mcp/mcp-connect-snippets.test.ts` | `apps/web-console-next/tests/consoleMcpServerDetail.test.tsx` | Served page, shared contract or interaction coverage. |
| `src/lib/mcp/mcp-server-detail.test.ts` | `apps/web-console-next/tests/consoleMcpServerDetail.test.tsx` | Served page, shared contract or interaction coverage. |
| `src/lib/snippets/snippet-catalog.test.ts` | `apps/web-console-next/tests/consoleRealtime-legacy-parity.test.ts` | Served page, shared contract or interaction coverage. |
| `src/lib/snippets/snippet-generator.test.ts` | `apps/web-console-next/tests/consoleStorage.test.tsx` | Served page, shared contract or interaction coverage. |
| `src/lib/structural-write-access.test.ts` | `apps/web-console-next/tests/consoleFunctions.test.tsx` | Served page, shared contract or interaction coverage. |
| `src/lib/workspace-secrets-access.test.ts` | `apps/web-console-next/tests/consoleWorkspaceSecrets.test.tsx` | Served page, shared contract or interaction coverage. |
| `src/no-hardcoded-light-mode-colors.test.ts` | `apps/web-console-next/scripts/lint-colours.mjs` | Served page, shared contract or interaction coverage. |
| `src/pages/ConsoleApiReferencePage.test.tsx` | `apps/web-console-next/tests/router.test.tsx` | Unrouted legacy-only surface; route-set and catch-all checks remain. |
| `src/pages/ConsoleAuthConfigPage.test.tsx` | `apps/web-console-next/tests/consoleAuthConfig.test.tsx` | Served page, shared contract or interaction coverage. |
| `src/pages/ConsoleAuthPage.test.tsx` | `apps/web-console-next/tests/consoleAuth-scope.test.tsx` | Served page, shared contract or interaction coverage. |
| `src/pages/ConsoleCapabilityCatalogPage.test.tsx` | `apps/web-console-next/tests/capabilities.test.tsx` | Served page, shared contract or interaction coverage. |
| `src/pages/ConsoleEventsDataPage.test.tsx` | `apps/web-console-next/tests/consoleEventsData-routing.test.tsx` | Served page, shared contract or interaction coverage. |
| `src/pages/ConsoleFlowDesignerPage.test.tsx` | `apps/web-console-next/tests/consoleFlowDesigner-rollback.test.tsx` | Served page, shared contract or interaction coverage. |
| `src/pages/ConsoleFlowHistoryPage.test.tsx` | `apps/web-console-next/tests/consoleFlowHistory-routing.test.tsx` | Served page, shared contract or interaction coverage. |
| `src/pages/ConsoleFlowRunPage.test.tsx` | `apps/web-console-next/tests/consoleFlowRun-routing.test.tsx` | Served page, shared contract or interaction coverage. |
| `src/pages/ConsoleFlowsPage.test.tsx` | `apps/web-console-next/tests/consoleFlows-routing.test.tsx` | Served page, shared contract or interaction coverage. |
| `src/pages/ConsoleFunctionRegistryPage.test.tsx` | `apps/web-console-next/tests/consoleFunctionRegistry.test.tsx` | Served page, shared contract or interaction coverage. |
| `src/pages/ConsoleFunctionsDataPage.test.tsx` | `apps/web-console-next/tests/consoleFunctionsData-routing.test.tsx` | Served page, shared contract or interaction coverage. |
| `src/pages/ConsoleFunctionsPage.test.tsx` | `apps/web-console-next/tests/consoleFunctions-routing.test.tsx` | Served page, shared contract or interaction coverage. |
| `src/pages/ConsoleIamAccessPage.test.tsx` | `apps/web-console-next/tests/consoleIamAccess-rollback.test.tsx` | Served page, shared contract or interaction coverage. |
| `src/pages/ConsoleKafkaPage.test.tsx` | `apps/web-console-next/tests/consoleKafka.test.tsx` | Served page, shared contract or interaction coverage. |
| `src/pages/ConsoleMcpServerDetailPage.test.tsx` | `apps/web-console-next/tests/consoleMcpServerDetail-routing.test.tsx` | Served page, shared contract or interaction coverage. |
| `src/pages/ConsoleMembersPage.test.tsx` | `apps/web-console-next/tests/consoleMembers-routing.test.tsx` | Served page, shared contract or interaction coverage. |
| `src/pages/ConsoleMongoDataPage.test.tsx` | `apps/web-console-next/tests/consoleMongoData.test.tsx` | Served page, shared contract or interaction coverage. |
| `src/pages/ConsoleMongoPage.test.tsx` | `apps/web-console-next/tests/consoleMongo-wizard.test.tsx` | Served page, shared contract or interaction coverage. |
| `src/pages/ConsoleObservabilityPage.test.tsx` | `apps/web-console-next/tests/consoleObservability.test.tsx` | Served page, shared contract or interaction coverage. |
| `src/pages/ConsoleOperationDetailPage.test.tsx` | `apps/web-console-next/tests/operationDetail.test.tsx` | Served page, shared contract or interaction coverage. |
| `src/pages/ConsoleOperationsPage.test.tsx` | `apps/web-console-next/tests/consoleOperations-navigation.test.tsx` | Served page, shared contract or interaction coverage. |
| `src/pages/ConsoleOverviewPage.test.tsx` | `apps/web-console-next/tests/overview.test.tsx` | Served page, shared contract or interaction coverage. |
| `src/pages/ConsolePlanCatalogPage.test.tsx` | `apps/web-console-next/tests/consolePlanCatalog-harness.test.ts` | Served page, shared contract or interaction coverage. |
| `src/pages/ConsolePlanCreatePage.test.tsx` | `apps/web-console-next/tests/consolePlanCreate.test.tsx` | Served page, shared contract or interaction coverage. |
| `src/pages/ConsolePlanDetailPage.test.tsx` | `apps/web-console-next/tests/consolePlanDetail-routing.test.tsx` | Served page, shared contract or interaction coverage. |
| `src/pages/ConsolePostgresDataPage.test.tsx` | `apps/web-console-next/tests/consolePostgresData-keys.test.tsx` | Served page, shared contract or interaction coverage. |
| `src/pages/ConsolePostgresPage.test.tsx` | `apps/web-console-next/tests/consolePostgres.test.tsx` | Served page, shared contract or interaction coverage. |
| `src/pages/ConsolePrivilegeDomainAuditPage.test.tsx` | `apps/web-console-next/tests/router.test.tsx` | Unrouted legacy-only surface; route-set and catch-all checks remain. |
| `src/pages/ConsolePrivilegeDomainPage.test.tsx` | `apps/web-console-next/tests/router.test.tsx` | Unrouted legacy-only surface; route-set and catch-all checks remain. |
| `src/pages/ConsoleProfilePage.test.tsx` | `apps/web-console-next/tests/ConsoleProfilePage.test.tsx` | Served page, shared contract or interaction coverage. |
| `src/pages/ConsoleQuotasPage.test.tsx` | `apps/web-console-next/tests/consoleQuotas-routing.test.tsx` | Served page, shared contract or interaction coverage. |
| `src/pages/ConsoleRealtimeChangesPage.test.tsx` | `apps/web-console-next/tests/consoleRealtimeChanges.test.tsx` | Served page, shared contract or interaction coverage. |
| `src/pages/ConsoleRealtimePage.test.tsx` | `apps/web-console-next/tests/consoleRealtime-legacy-parity.test.ts` | Served page, shared contract or interaction coverage. |
| `src/pages/ConsoleRuntimePage.test.tsx` | `apps/web-console-next/tests/consoleRuntime.test.tsx` | Served page, shared contract or interaction coverage. |
| `src/pages/ConsoleScopeEnforcementPage.test.tsx` | `apps/web-console-next/tests/router.test.tsx` | Unrouted legacy-only surface; route-set and catch-all checks remain. |
| `src/pages/ConsoleSecretRotationPage.test.tsx` | `apps/web-console-next/tests/consoleSecretRotation-navigation.test.tsx` | Served page, shared contract or interaction coverage. |
| `src/pages/ConsoleSecretsPage.test.tsx` | `apps/web-console-next/tests/consoleSecrets-rollback.test.tsx` | Served page, shared contract or interaction coverage. |
| `src/pages/ConsoleServiceAccountsPage.test.tsx` | `apps/web-console-next/tests/consoleServiceAccounts.test.tsx` | Served page, shared contract or interaction coverage. |
| `src/pages/ConsoleSettingsPage.test.tsx` | `apps/web-console-next/tests/ConsoleSettingsPage.test.tsx` | Served page, shared contract or interaction coverage. |
| `src/pages/ConsoleStoragePage.test.tsx` | `apps/web-console-next/tests/consoleStorage-rollback.test.tsx` | Served page, shared contract or interaction coverage. |
| `src/pages/ConsoleTenantAllocationSummaryPage.test.tsx` | `apps/web-console-next/tests/consoleTenantAllocationSummary.test.tsx` | Served page, shared contract or interaction coverage. |
| `src/pages/ConsoleTenantPlanOverviewPage.test.tsx` | `apps/web-console-next/tests/consoleTenantPlanOverview-rollback.test.tsx` | Served page, shared contract or interaction coverage. |
| `src/pages/ConsoleTenantPlanPage.test.tsx` | `apps/web-console-next/tests/consoleTenantPlan-routing.test.tsx` | Served page, shared contract or interaction coverage. |
| `src/pages/ConsoleTenantsPage.test.tsx` | `apps/web-console-next/tests/consoleTenants-registry.test.mjs` | Served page, shared contract or interaction coverage. |
| `src/pages/ConsoleWorkspaceDashboardPage.test.tsx` | `apps/web-console-next/tests/consoleWorkspaceDashboard.test.tsx` | Served page, shared contract or interaction coverage. |
| `src/pages/ConsoleWorkspaceDatabasePage.test.tsx` | `apps/web-console-next/tests/consoleWorkspaceDatabase-routing.test.tsx` | Served page, shared contract or interaction coverage. |
| `src/pages/ConsoleWorkspaceSecretsPage.test.tsx` | `apps/web-console-next/tests/consoleWorkspaceSecrets-harness.test.ts` | Served page, shared contract or interaction coverage. |
| `src/pages/ConsoleWorkspacesPage.test.tsx` | `apps/web-console-next/tests/consoleWorkspaces-routing.test.tsx` | Served page, shared contract or interaction coverage. |
| `src/pages/InvitationAcceptancePage.test.tsx` | `apps/web-console-next/tests/welcome.test.tsx` | Served page, shared contract or interaction coverage. |
| `src/pages/LoginPage.test.tsx` | `apps/web-console-next/tests/login.test.tsx` | Served page, shared contract or interaction coverage. |
| `src/pages/NotFoundPage.test.tsx` | `apps/web-console-next/tests/notFound.test.tsx` | Served page, shared contract or interaction coverage. |
| `src/pages/PasswordRecoveryPage.test.tsx` | `apps/web-console-next/tests/recovery.test.tsx` | Served page, shared contract or interaction coverage. |
| `src/pages/PendingActivationPage.test.tsx` | `apps/web-console-next/tests/pendingActivation.test.tsx` | Served page, shared contract or interaction coverage. |
| `src/pages/SignupPage.test.tsx` | `apps/web-console-next/tests/signup.test.tsx` | Served page, shared contract or interaction coverage. |
| `src/pages/WelcomePage.test.tsx` | `apps/web-console-next/tests/welcome-boundary.test.tsx` | Served page, shared contract or interaction coverage. |
| `src/pages/form-control-legibility.test.tsx` | `apps/web-console-next/tests/consolePostgresData-legibility.test.tsx` | Served page, shared contract or interaction coverage. |
| `src/router.auth-layout-wiring.test.tsx` | `apps/web-console-next/tests/router.test.tsx` | Served page, shared contract or interaction coverage. |
| `src/router.lazy-route-guard.test.tsx` | `apps/web-console-next/tests/router.test.tsx` | Served page, shared contract or interaction coverage. |
| `src/router.runtime.test.ts` | `apps/web-console-next/tests/router.test.tsx` | Served page, shared contract or interaction coverage. |
| `src/router.test.tsx` | `apps/web-console-next/tests/router.test.tsx` | Served page, shared contract or interaction coverage. |
| `src/services/authConfigApi.test.ts` | `apps/web-console-next/tests/consoleAuthConfig.test.tsx` | Served page, shared contract or interaction coverage. |
| `src/services/eventsApi.test.ts` | `apps/web-console-next/tests/consoleEventsData.test.tsx` | Served page, shared contract or interaction coverage. |
| `src/services/flowsApi.test.ts` | `apps/web-console-next/tests/consoleFlows.test.tsx` | Served page, shared contract or interaction coverage. |
| `src/services/flowsMonitoringApi.test.ts` | `apps/web-console-next/tests/consoleFlowHistory.test.tsx` | Served page, shared contract or interaction coverage. |
| `src/services/functionsApi.test.ts` | `apps/web-console-next/tests/consoleFunctions.test.tsx` | Served page, shared contract or interaction coverage. |
| `src/services/mongoApi.import.test.ts` | `apps/web-console-next/tests/consoleMongoData.test.tsx` | Served page, shared contract or interaction coverage. |
| `src/services/mongoApi.test.ts` | `apps/web-console-next/tests/consoleMongoData.test.tsx` | Served page, shared contract or interaction coverage. |
| `src/services/planManagementApi.test.ts` | `apps/web-console-next/tests/consoleTenantPlan.test.tsx` | Served page, shared contract or interaction coverage. |
| `src/services/postgresApi.test.ts` | `apps/web-console-next/tests/consolePostgres.test.tsx` | Served page, shared contract or interaction coverage. |
| `src/services/realtimeApi.test.ts` | `apps/web-console-next/tests/consoleRealtimeChanges.test.tsx` | Served page, shared contract or interaction coverage. |
| `src/services/secretsApi.test.ts` | `apps/web-console-next/tests/consoleWorkspaceSecrets.test.tsx` | Served page, shared contract or interaction coverage. |
| `src/styles/brand-tokens.test.ts` | `apps/web-console-next/scripts/lint-colours.mjs` | Served page, shared contract or interaction coverage. |
| `src/styles/globals.test.ts` | `apps/web-console-next/tests/runtimeStatusColours.test.tsx` | Served page, shared contract or interaction coverage. |

## Shared tests

| Removed test or check | Counterpart / retained behavior |
| --- | --- |
| managed-knative-console/function-lifecycle-affordances.test.tsx | apps/web-console-next/tests/consoleFunctions.test.tsx: unavailable and deletion_pending disable every write with a reason |
| managed-knative-console/runtime-console-ui.test.tsx | apps/web-console-next/tests/consoleRuntime.test.tsx and consoleMcpServerDetail.test.tsx: status, readiness, navigation, focus and retries |
| managed-knative-console/function-mutation-consumer.test-d.ts | apps/web-console-next/tests/consoleFunctions.test.tsx: create, update, rollback and delete requests/results; the legacy-only exported envelope aliases retire with their client |
| managed-knative-console/{vitest.config.ts,tsconfig.json} | Next app test runner and typecheck; runner now invokes named next suites |
| console-service-accounts-page.legacy.mjs | console-service-accounts-page.spec.mjs: all five request/refetch/disclosure journeys compare with independent frozen literals instead of building the removed app |
| tenant-management.test.mjs console-helper assertions | consoleTenants.test.tsx; backend lifecycle/export/purge assertions stay in the shared file |
| workspace-management.test.mjs console-helper assertions | consoleWorkspaces.test.tsx and consoleWorkspaceDashboard.test.tsx; backend clone/inheritance/API assertions stay |
| postgres-admin.test.mjs two console-helper test cases | consolePostgres.test.tsx and consolePostgresData.test.tsx; backend catalogue/compatibility cases stay |
| observability-quota-usage-view.test.mjs console-helper assertions | consoleObservability.test.tsx and consoleQuotas.test.tsx; backend policy/provisioning/scope checks stay |
| public-api.catalog.test.mjs legacy console grouping | Same generated public family/route assertions retained through control-plane routes, with no legacy wrapper import |
| postgresql-admin-sql.test.mjs legacy view model | Same preview/execute fingerprint check retained through the public PostgreSQL adapter |

All remaining shared consumers are repointed, including the serving request matrices (unsafe
redirect cases unchanged), root build context, version build, YAML round trips, dependency
overrides, reconciliation, repository layout, CI contracts and gateway call-site inventory.
The shared console API static-secret inventory test also uses literal legacy rows captured from
`ConsoleSecretsPage` at the immutable base, in `packages/console-api/tests/fixtures/legacy-platform-secret-inventory.json`.
Client comparisons and snippet bytes are frozen beside the next tests, with provenance in
`apps/web-console-next/tests/frozen-legacy/README.md`.

Browser parity (32 shards), axe, viewport and CSP browser execution require PR CI:
Chromium is unavailable in the maker sandbox. Parity screenshots still require checker
assessment and operator approval. Docker builds require access to a Docker daemon. The chart
maker must validate its matching OpenShift BuildConfig and chart tests separately.

## Maker verification after dependency resolution

The original moved-path reproduction (`node --test tests/unit/web-console-static-routing.test.mjs`)
failed with `ERR_MODULE_NOT_FOUND` before the move. The retirement test rejected the existing
legacy tree and its live consumers. The confirmed cause was serving configuration and test/tool
consumers still rooted in the retired app. The server blob remains unchanged
(`d1886d2da1088e0aec2367e523fed01e5428fdee`).

After the regenerated lockfile was installed, `cd apps/web-console-next && node
node_modules/typescript/bin/tsc --noEmit` failed with ten TS2503 diagnostics in eight files.
Those annotations depended on the global JSX namespace from the removed app's React 18
imports. Explicit type-only JSX imports from next's React 19 dependency make the same command
pass without changing emitted code or page behavior.

Passed after dependency resolution: TypeScript checking, static routing (including unsafe
redirect targets), Docker context, retirement/runtime-import checks, dependency overrides,
release-image workflow, version build, YAML round trips, public API catalogue, gateway call-site
inventory, backend tenant/workspace/PostgreSQL/observability consumers, adapter SQL behavior,
gntik-ui manifest/lockfile pins, CI contracts, parity structure and fixture scanning.
Structure validation passed with the assigned chart worktree; temporarily removing the moved
Dockerfile made it fail naming that file, and the file was restored.

The full next Vitest command and the offline frozen install cannot run through pnpm here:
workspace discovery reports `spawnSync /usr/local/bin/node EPERM`. Direct Vitest attempts
also stalled before reporting assertions; this is not a passing suite. No fixture-mode full
Vitest run was used. Catalogue validation/repository layout/source-build validation encounter
`spawnSync git EPERM`, even with the assigned repository configured as safe for that command.
The static-server HTTP matrix encounters `listen EPERM`; its route-only and static configuration
checks pass, but its socket checks must run in CI. The snippet CLI and its Python subprocess
checks stalled. These environment-limited checks are not reported as code failures.

Both Docker build commands encounter permission denied on `/var/run/docker.sock`. Browser
parity (all 32 shards), axe, viewport and CSP execution remain for PR CI because Chromium is
unavailable. Screenshot assessment and operator approval remain necessary. The deployment
maker owns the matching chart change and Helm/chart verification. No deployment, publication
or release credential access was performed.
