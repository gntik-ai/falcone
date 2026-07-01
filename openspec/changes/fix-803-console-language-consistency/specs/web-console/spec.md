# web-console Specification (delta)

## ADDED Requirements

### Requirement: Authenticated console renders in the declared language

The system SHALL render authenticated web-console chrome, navigation, and page-level user-facing
copy in the same default language as the document `lang` attribute, while keeping only technical
protocol/product identifiers untranslated when they are clearer as domain nouns.

#### Scenario: Console renders in one declared language

- **WHEN** an authenticated user views any console screen
- **THEN** the document `lang` attribute matches the default console language
- **AND** shell chrome, navigation, page headings, tabs, filters, badges, table headers, and empty,
  loading, and error states use that language consistently
- **AND** shared semantic validation messages surfaced in the console, including flow designer
  `FLW-E` diagnostics, use that language while preserving stable error codes and technical values
- **AND** entity labels use Spanish UI nouns such as `organización` and `área de trabajo`
- **AND** accepted technical terms of art such as API, SDK, service account, OAuth/OIDC,
  PostgreSQL, MongoDB, Kafka, JWT, and SSE may remain as product/domain terms
