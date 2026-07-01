# 1. Reproduce / encode the contract

- [x] 1.1 Confirm the reported root: the boot document declares `lang="es"` while authenticated
  console shell navigation and key pages still render English user-facing copy.
- [x] 1.2 Add focused web-console regression coverage for the shell/document language contract.
- [x] 1.3 Add focused web-console regression coverage for the reported Observability page mix.

# 2. Fix

- [x] 2.1 Keep `<html lang="es">` and make the boot document title/application name Spanish.
- [x] 2.2 Translate authenticated console shell navigation, route badges, and profile menu labels
  to Spanish.
- [x] 2.3 Translate the cited Observability page labels and audit filter outcomes to Spanish.
- [x] 2.4 Translate plan/quota page and shared table/badge copy that previously exposed English
  labels in the authenticated console.
- [x] 2.5 Preserve accepted technical terms of art where translating them would reduce clarity or
  drift from API/domain names.
- [x] 2.6 Translate MCP detail/playground route tabs, scope badges, headings, empty states, and
  helper copy while preserving technical identifiers.
- [x] 2.7 Translate shared flow semantic validation messages rendered in the authenticated console
  problems panel while preserving `FLW-E` codes and technical values.

# 3. Docs / OpenSpec / wire

- [x] 3.1 Materialize this OpenSpec change under
  `openspec/changes/fix-803-console-language-consistency/`.
- [x] 3.2 Add `docs/reference/architecture/console-language-policy.md`.
- [x] 3.3 Leave OpenAPI, generated clients, shared types, backend routes, auth claims, and
  real-time event shapes unchanged because no wire contract changes are required.

# 4. Verify

- [x] 4.1 Run focused web-console tests for shell, observability, plan/quota components, pages, and
  the MCP detail/playground route.
- [x] 4.1a Run focused shared flow validator and flow problems panel tests for Spanish semantic
  validation messages.
- [x] 4.2 Run the full web-console Vitest suite or record any unrelated baseline failure.
- [x] 4.3 Run `openspec validate fix-803-console-language-consistency --strict`.
- [x] 4.4 Run `npm run validate:openapi` and `npm run generate:public-api`; confirm no tracked
  codegen diff.
- [x] 4.5 Run `git diff --check origin/main...HEAD`.
