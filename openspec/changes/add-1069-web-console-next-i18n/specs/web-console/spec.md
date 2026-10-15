## ADDED Requirements

### Requirement: Spanish-default client locale

The next console SHALL support only es and en through ICU-capable i18next. It
SHALL use a supported `falcone-next-locale` localStorage preference, otherwise es,
without consulting navigator language. Invalid or unavailable storage SHALL NOT
prevent rendering. Existing Spanish shell and placeholder strings SHALL be preserved.

#### Scenario: First load or invalid preference

- **WHEN** no supported preference exists, including when navigator.language is en
- **THEN** HTML lang SHALL be es and shell and placeholder copy SHALL be Spanish.

#### Scenario: Change and reload

- **WHEN** a user chooses en in the header user menu or /console/settings
- **THEN** HTML lang, shell and route copy SHALL change to English, the preference
  SHALL persist, and Intl dates, numbers and relative times SHALL use English.
- **WHEN** the application reloads
- **THEN** the saved English locale and formatting SHALL remain active.

### Requirement: Local resources and translated shared UI

The common namespace SHALL cover shell/navigation, loading, empty, 401, 403, 404,
500, network, confirmations and pagination/filter/saved-view fallbacks. Every
lazy page module SHALL bundle its own es/en namespace resources outside the
static entry import graph. All resources SHALL be self-hosted static JSON imports;
there SHALL be no HTTP translation backend or added CSP permission.

#### Scenario: Localized status harness

- **WHEN** the harness renders the shell and each status in either supported locale
- **THEN** text, accessible names, aria-label, title, placeholder and LiveAnnouncer
  messages SHALL contain translated copy without raw keys or other-language fallback.
- **AND** kit labels SHALL be provided explicitly where supported, with common
  fallbacks used when kit controls cannot localize their built-in copy.

#### Scenario: Existing asset gates

- **WHEN** building at / and /next/
- **THEN** route namespace chunks SHALL remain lazy and the existing CSP and
  validate:dist checks SHALL pass without remote resources or inline scripts.

### Requirement: Translation gates

Node ESM check:i18n and lint:i18n SHALL accept fixture paths. check:i18n SHALL
reject any key present in only one locale and any namespace referenced by a
route without both resource files. lint:i18n SHALL reject untranslated JSX text
and string-literal aria-label, title and placeholder attributes in src while
allowing translated expressions and non-copy attributes.

#### Scenario: Negative fixtures

- **WHEN** a fixture omits a key in either locale, references a missing namespace,
  or introduces any of the prohibited JSX literals
- **THEN** the relevant CLI SHALL exit nonzero.
- **WHEN** checking committed source and resources or clean fixtures
- **THEN** both CLIs SHALL exit zero.

#### Scenario: Enforced CI

- **WHEN** the next-console CI job runs
- **THEN** it SHALL enforce both new gates and fixture suites alongside typecheck,
  tests, lint:colours, exact gntik-ui pin validation, both base builds and CSP checks.
- **AND** the CI unit test SHALL assert the new enforced steps exist.
