# Console language policy

The authenticated web console defaults to Spanish. The boot document keeps `<html lang="es">`,
and user-facing console chrome, navigation, headings, tabs, filters, badges, tables, empty states,
loading states, and error states should be written in Spanish unless a screen implements a complete
language-switching catalog.

## Terms of art

Falcone still uses some platform terms as product/domain nouns because translating them would make
the UI less precise or drift from the API and documentation:

- API, SDK, JWT, SSE, OAuth, OIDC
- service account
- PostgreSQL, MongoDB, Kafka
- provider, realm, runtime, deploy, publish, stream, topic

Use these terms consistently. Do not mix English interface verbs and labels around them. Entity
labels should use Spanish UI nouns: `organización` for tenant and `área de trabajo` for workspace.
For example, prefer `Cuentas de servicio` over `Service Accounts`, `Observabilidad` over
`Observability`, and `Métricas` / `Auditoría` over `Metrics` / `Audit`.

## Regression guard

Issue #803 is covered by focused tests in the shell, Observability page, and MCP detail route:

- `ConsoleShellLayout.test.tsx` checks that the boot document declares `lang="es"` and that the
  authenticated shell navigation no longer exposes the reported English labels.
- `ConsoleObservabilityPage.test.tsx` checks that the reported Observability heading and tab labels
  render in Spanish while the audit filters remain coherent.
- `ConsoleMcpServerDetailPage.test.tsx` and `McpServerPlayground.test.tsx` check that MCP
  detail/playground tabs, scope badges, headings, helper labels, and empty states render in Spanish
  while technical identifiers stay unchanged.
- `flow-definition-validator.test.mjs`, `FlowSemanticValidation.test.ts`, and
  `FlowProblemsPanel.test.tsx` check that shared `FLW-E` semantic validation messages render in
  Spanish while preserving codes, node IDs, task type identifiers, cron strings, and durations.

This policy is frontend-only. It does not affect backend API contracts, generated SDKs, auth
claims, persistence, or real-time event shapes.
