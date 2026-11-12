# Pin gntik-ui 0.12.0 and tokens 0.4.0

## Why

Issue #1625 moves the next console to the kit release required by #1497 and the stacked-toast accessibility fix. This R2 source-only dependency update adopts no new kit features. Reverting the change restores the previous manifest, lockfile and pin gate together.

## Changes

- Pin `@gntik-ai/ui`, `@gntik-ai/blocks` and `@gntik-ai/templates` to exactly `0.12.0`, and `@gntik-ai/tokens` to exactly `0.4.0`.
- Use the platform-regenerated public npm lockfile. Charts, chat, editor and flow resolve to `0.12.0`; icons remains `0.5.0`, as required by this release. No old kit or token versions remain.
- Update the pin CLI and its fixtures. Add a CLI regression rejecting the previous `0.11.0`/`0.3.0` pins, retaining the older version, range, missing-package, mismatch and tarball-host negatives. Keep the tarball-host check unchanged.
- Add no direct dependencies and change no legacy-console files, workflows or deployment files.

## Release compatibility review and PR description handoff

- **Density-aware MultiSelect/TokenInput/Textarea:** the console has no MultiSelect or TokenInput call sites and introduces no DensityProvider. Existing Textarea sizes remain explicit where supplied; omitted sizes use the kit's comfortable default. No density feature is adopted. Textarea layout still needs browser parity review.
- **Keyboard-only focus ring:** existing console focus utilities use `focus-visible`; the kit's `focus-ring` utility now does too. Keep the kit behavior and existing call sites. Keyboard focus, axe and viewport coverage remain CI gates.
- **Cursor tokens:** inherit interactive and disabled cursor tokens through the existing stylesheet. Disabled Buttons receive pointer events but remain inert through the kit/Base UI disabled state. No event workaround or wrapper is added; existing disabled-action tests remain enforced.
- **Typography roles:** retain named Text/Heading roles and existing explicit sizes. The two mobile table labels using `Text` with `text-sm` in `consoleTenantAllocationSummary.tsx` and `consoleTenantPlanOverview/Summary.tsx` intentionally request a font size; that override replaces the role in 0.12.0. No new overrides are introduced. Their inherited line height and other role changes require visual review.
- **Tokens 0.4.0 palette CSS:** `@gntik-ai/templates/styles.css` remains the only kit stylesheet import. Its existing import chain supplies the tokens and palette declarations; no palette is selected or adopted. The Geist font-token overrides remain in place. StatusTag now renders semantic `data-tone` attributes with generic `bg-tone` dots. The earlier unit-test adaptations assert exact destructive/success/info/warning/neutral tones and the token-backed dot. Operation tone expectations use independent literal mappings. The runtime uses the kit's own tone backgrounds without a class override. Its browser and unit assertions check exact `data-tone` values rather than kit-internal background utility names; neutral remains the kit's translucent neutral tone. All scenarios and polling/interaction assertions remain enforced.
- **Base UI 1.9:** the regenerated lockfile retains the existing `@base-ui/react@1.9.0` resolution. No Base UI prop adaptation is required by typechecking. Existing interaction and accessibility tests remain enforced.

The lockfile adds the chat package's `rehype-raw` and `rehype-sanitize` dependency trees, including a separate parse5 8/entities 9 path. Every other importer and every retained dependency snapshot is unchanged from `5be325b8`; no shared legacy transitive version shifts were found.

## Visual-review handoff

No parity screenshot was regenerated in the maker sandbox: Chromium is unavailable. The checker must assess CI parity screenshots and obtain operator visual approval. If a baseline needs changing, list each screenshot path in the PR with a one-line reason tied to density, keyboard focus, cursor, typography, palette CSS or Base UI. Regenerate only screenshots whose rendered output changed; do not mass-update baselines.

## Validation limits

The new old-pin rejection was observed failing before the gate update with `node --test tests/unit/gntik-ui-pin.test.mjs` (the CLI accepted old pins with status 0); the updated CLI rejects them with status 1. The tested public seam is the CLI with temporary manifest/lockfile fixtures and peer-suffixed versions.

Fresh-container installation with an empty store and registry integrity comparison require network and Docker, unavailable here. The pnpm launcher also reports `spawnSync /usr/local/bin/node EPERM`; installed Node tool entrypoints are used for local checks. The current repair attempt cannot start the Docker build: `mkdir /var/lib/engineering-control/identities/codex-runner/.docker: read-only file system`. The earlier attempt also reported permission denied on `/var/run/docker.sock`. PR CI must run the clean-room install, public registry integrity comparison, browser suites and image build, including both bundles.

## CI repair handoff

The supplied shard 6/7 CI logs are the red evidence: the runtime's background-class regex fails because StatusTag 0.12.0 emits generic `bg-tone` utilities with semantic `data-tone` values. The checker confirmed that the subsequent class override duplicated success/warning tints and incorrectly made neutral badges opaque. Remove that override and change the parity assertion to exact success/warning/neutral `data-tone` values, matching the existing unit-test adaptation. The added `runtimeStatusColours.test.tsx` retains all six state/label/tone cases and drops only the kit-internal class assertions that locked in the override. The public seam remains the rendered runtime page with real kit components and HTTP-boundary fixtures. No polling, interaction, accessibility or screenshot assertions are removed or narrowed. Chromium parity cannot run locally; PR CI must verify the corrected browser assertion.

Repair validation passed: `node scripts/validate-gntik-ui-pin.mjs`, `node --test tests/unit/gntik-ui-pin.test.mjs`, console `tsc --noEmit`, colour lint, parity fixture scanning/validation, and the CI/parity tooling unit suites. The normal console Vitest run passed 129 files and 2,450 tests, with four expected failures and three existing skipped tests (one skipped file). No new skip or expected failure was added. The repair also leaves the runtime source identical to its base version.

Shard 4's earlier supplied failure occurred inside the shared page-open busy assertion, before the in-flight poll or paging action. The latest supplied CI failures list only shard 7 and the aggregate job; no change is made to that startup journey.

The latest shard 7 log identifies six overview responsive failures at 1280px, across all three roles and both locales: the inventory list has two columns instead of four. This CI run supplies red evidence at the existing public browser seam (`tests/parity/pages/overview.spec.mjs`, responsive case). KpiRow 0.12.0 uses container queries: four columns require a 56rem container, which the sidebar and page/card padding leave unavailable at that viewport. Preserve the existing desktop layout at the overview call site with an explicit `lg:grid-cols-4!` override and matching strip dividers between all four cells. The kit's one/two-column layouts at 375px/768px remain covered by the unchanged parity assertions. No test or screenshot is changed. PR CI must rerun shard 7 and the aggregate `ui-parity` gate; Chromium is unavailable locally.

Overview repair validation uses installed Node tool entrypoints because the pnpm launcher still reports `spawnSync /usr/local/bin/node EPERM`. Typechecking, pin validation and tests, colour/i18n checks and fixtures, parity structure tooling, the `/next/` production build, dist validation, translation chunks and release fixture exclusion pass. The emitted CSS contains the important desktop four-column rule and the desktop strip divider rule; built asset paths retain `/next/`. The diff audit confirms no legacy-console changes, new dependency keys or additional kit stylesheet imports. Docker still cannot create its configuration directory on the read-only filesystem. Browser parity, axe and viewport verification remain assigned to PR CI; no screenshots were regenerated.

The normal console Vitest run also passes: 129 files and 2,450 tests, with four expected failures and three existing skipped tests (one skipped file). This repair adds no skip or expected failure.
