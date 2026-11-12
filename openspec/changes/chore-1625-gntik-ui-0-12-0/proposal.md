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
- **Tokens 0.4.0 palette CSS:** `@gntik-ai/templates/styles.css` remains the only kit stylesheet import. Its existing import chain supplies the tokens and palette declarations; no palette is selected or adopted. The Geist font-token overrides remain in place. StatusTag now renders semantic `data-tone` attributes with generic `bg-tone` dots. After observing four failures in the unchanged secret-rotation/service-account tests, update their old class-specific checks to assert exact destructive/success/info/neutral tones and the token-backed dot. Keep all scenarios and polling/interaction assertions; no product workaround is needed.
- **Base UI 1.9:** the regenerated lockfile retains the existing `@base-ui/react@1.9.0` resolution. No Base UI prop adaptation is required by typechecking. Existing interaction and accessibility tests remain enforced.

The lockfile adds the chat package's `rehype-raw` and `rehype-sanitize` dependency trees, including a separate parse5 8/entities 9 path. Every other importer and every retained dependency snapshot is unchanged from `5be325b8`; no shared legacy transitive version shifts were found.

## Visual-review handoff

No parity screenshot was regenerated in the maker sandbox: Chromium is unavailable. The checker must assess CI parity screenshots and obtain operator visual approval. If a baseline needs changing, list each screenshot path in the PR with a one-line reason tied to density, keyboard focus, cursor, typography, palette CSS or Base UI. Regenerate only screenshots whose rendered output changed; do not mass-update baselines.

## Validation limits

The new old-pin rejection was observed failing before the gate update with `node --test tests/unit/gntik-ui-pin.test.mjs` (the CLI accepted old pins with status 0); the updated CLI rejects them with status 1. The tested public seam is the CLI with temporary manifest/lockfile fixtures and peer-suffixed versions.

Fresh-container installation with an empty store and registry integrity comparison require network and Docker, unavailable here. The pnpm launcher also reports `spawnSync /usr/local/bin/node EPERM`; installed Node tool entrypoints are used for local checks. Docker build is blocked by permission denied on `/var/run/docker.sock`. PR CI must run the clean-room install, public registry integrity comparison, browser suites and image build, including both bundles.
