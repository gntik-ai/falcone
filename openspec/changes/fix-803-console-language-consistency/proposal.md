# Why

The authenticated web console served `<html lang="es">` while visible console chrome and key
capability pages mixed Spanish and English copy. Navigation labels such as "Overview",
"Observability", and "Service Accounts" appeared alongside Spanish section headers and controls,
which made the console feel unfinished and gave assistive technology an inaccurate language signal.

# What Changes

- Keep Spanish as the explicit default console language because the shell, auth flow, validation,
  and most existing operational copy already use Spanish and the boot document already declares
  `lang="es"`.
- Translate authenticated shell navigation, profile menu labels, overview/profile/settings route
  badges, and the reported observability page labels into Spanish.
- Translate plan/quota surfaces and shared plan/quota badges/tables that were called out as
  English-heavy in the issue evidence.
- Translate MCP detail/playground route tabs, scope badges, headings, empty states, and helper copy
  while preserving technical protocol and identifier terms such as MCP, OAuth, Endpoint, and JSON.
- Translate shared flow semantic validation messages rendered by the designer problems panel while
  preserving stable `FLW-E` codes and technical values such as node IDs, task type identifiers, and
  cron/expression strings.
- Preserve technical identifiers where the product needs API precision, such as API, SDK, service
  account, OAuth/OIDC, PostgreSQL, MongoDB, Kafka, JWT, SSE, and similar protocol or product names.
  Render entity labels in Spanish as `organización` and `área de trabajo`.
- Add focused regression coverage for the shell/document language contract, the cited
  Observability page, and the MCP detail/playground route.
- Document the console language policy for future web-console changes.

# Contract / Wire Impact

This is a frontend copy and accessibility metadata change only. It does not change backend API
routes, request or response schemas, auth claims, OpenAPI, AsyncAPI, generated SDKs, shared wire
types, persistence, or real-time event shapes. Public API code generation should remain a no-op.

# Capabilities

## Added Capabilities

- `web-console`: authenticated console screens use one declared UI language by default, with
  `<html lang>` matching the rendered console language.
