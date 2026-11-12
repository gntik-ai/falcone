## MODIFIED Requirements

### Requirement: Exact public kit pins

The next console SHALL pin `@gntik-ai/ui`, `@gntik-ai/blocks` and `@gntik-ai/templates` to `0.12.0` and `@gntik-ai/tokens` to `0.4.0` in its manifest and lockfile importer. The update SHALL add no direct dependency and SHALL change no file under `apps/web-console/`.

#### Scenario: Current exact pins

- **WHEN** the pin CLI reads matching manifest and lockfile entries for these versions, including peer suffixes
- **THEN** it exits 0.

#### Scenario: Invalid or obsolete pins

- **WHEN** pins use ranges, omit a package, disagree with the lockfile, or use the previous `0.11.0`/`0.3.0` versions or older versions covered by the gate
- **THEN** the pin CLI exits 1.

#### Scenario: Public package resolution

- **WHEN** the workspace is installed in a fresh container with an empty store, no user or global npm configuration and default/scoped registries set to `https://registry.npmjs.org/`
- **THEN** `pnpm install --frozen-lockfile` succeeds
- **AND** every kit lockfile integrity equals the public registry's `dist.integrity`
- **AND** any explicit kit tarball uses HTTPS on `registry.npmjs.org`
- **AND** the lockfile contains no GitHub Packages URL or authentication token.

### Requirement: Preserve console behavior across the kit update

The update SHALL adopt no new kit features, retain `@gntik-ai/templates/styles.css` as the only kit stylesheet import, and preserve all existing test gates. Required compatibility fixes SHALL be made at call sites without wrappers hiding kit behavior.

#### Scenario: Overview inventory responsiveness

- **WHEN** an overview with inventory summaries is viewed at 375px, 768px or 1280px
- **THEN** the inventory list retains one, two or four columns respectively
- **AND** the desktop strip has dividers between adjacent cells.

#### Scenario: Release validation

- **WHEN** the dependency update is validated
- **THEN** the web-console-next and all ui-parity CI jobs pass
- **AND** the shared Docker image builds both the legacy and `/next/` bundles
- **AND** the PR documents density, keyboard-only focus rings, cursor tokens and disabled-button behavior, typography-role overrides, tokens 0.4.0 palette CSS and Base UI 1.9
- **AND** each regenerated parity screenshot has a reason tied to one of those changes, with unchanged screenshots left intact.
