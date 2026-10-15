# Add Spanish-default i18n to the next console

## Why

Issue #1069 establishes the shared i18n foundation for UI wave u0. The separate
next console currently embeds Spanish shell and placeholder copy without a saved
locale, English translations, locale-aware formatting or translation gates.

## What changes

- Initialize exactly pinned i18next, react-i18next, i18next-icu and
  intl-messageformat with Spanish and English. Default to Spanish regardless of
  browser language; honor only a supported `falcone-next-locale` localStorage value.
- Translate the shell and preserve its existing Spanish copy. Provide the same
  locale control in the user menu and settings placeholder. Update HTML language,
  rendered copy, localStorage and Intl date/number/relative-time formatting.
- Bundle the common shell, navigation, status, confirmation, pagination, filter
  and saved-view fallbacks locally. Load each placeholder page namespace with its
  lazy page module; unimplemented console routes share the pending-page chunk.
- Add source-parser-based Node ESM checks for locale key parity, referenced
  namespaces and untranslated JSX text/aria-label/title/placeholder literals.
- Enforce the checks and their fixture suites in CI, test built namespace chunk
  isolation at both bases, and extend the unchanged-CSP browser harness with
  locale switching, reload persistence and formatting checks.

## Boundaries and rollback

R1, confined to apps/web-console-next, its existing CI job and the matching CI
unit test. No legacy-console source, UI kit pins, CSP, deployment charts or release
workflow changes. No remote resource backend, browser locale detection, server
preference storage, additional locale or page migration. Revert the change or
stop serving /next/ to disable it. Future server-side preference storage is deferred.
