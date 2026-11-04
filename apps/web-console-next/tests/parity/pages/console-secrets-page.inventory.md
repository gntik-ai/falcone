# Secret inventory parity

Assigned worktree lease: agent/falcone/1264/75aaaa5c-9d8c-5161-869f-31dfba765b90, clean base 62554134a4351dc74e50065c70afbb0c7452e01c. Approved page entry SHA256: 078052df8e17519bf123073e8ab47288297d96d0104a20c11fd6c4a304d94fec. Offline Hermes kit snapshot SHA256: 956ed2f229f339c2050eb42f28f629257f8b61781951603b7baf9f049a842a93.

Blueprint d52c1d932d0f68f904568c8caf9694f0ae2046daf5220d2b6465df6a0355f15d, page console-secrets-page, issue #1264 revision 4. The amendment replaces the old static data and revoke 404 route-gap fixture with live inventory metadata and VERSION_NOT_FOUND.

- The page owns two exact-query GETs, no limit or offset; principal tenantIds has the sole synthetic binding tenant-a. Shared CSP session retains tenantIds=[] and accepts only the two unbound exact GETs.
- Contract-shaped fixtures contain metadata only, including currentVersion.activatedAt and active/grace state. The legacy buildPlatformSecretInventoryFixture stays unchanged.
- Cases: static-inventory (the approved fixture name, now served by live GETs), delayed skeleton, empty, 50+50 rows, tenant-b and nested-platform binding failures, null currentVersion, inventory 403/404/500/network and mixed-outcome precedence.
- Revocation: typed-name gate, force initialization, cancel/Escape and focus return, pending protection, exact body, no inventory refetch, 401 single refresh without POST replay, 403 no-access, 404 not-found/history, 409/500/503/network explicit retry with fields preserved.
- Root-relative Rotate/History links hand off to the legacy rotation route, including under /next. Rollback removes migrated dispatch through its flag, renders pendingPage, and makes no inventory calls.
- All eight parity checks execute in es/en at 375/768/1280. Visual-review captures the list, force confirmation, no-access, not-found and error-panel; attachments carry SHA256 in the name. PR CI captures screenshots; operator baseline approval follows publication per the amendment. No browser is available in the maker sandbox.
- Only shell bootstrap, exact inventory GETs and revoke POSTs are allowed; refresh is used by the 401 case. No rotation/history/consumer requests are introduced.
- MCP validate_page is unavailable. The supplied offline gntik-ui 0.11.0 snapshot, installed kit types, explicit props and repository colour/i18n lints are used. EmptyState composes the first-run empty surface because FirstRunEmpty unconditionally renders an action, which this page does not have. AlertDialog composes the destructive pattern because ConfirmDestructive has no extra-fields/error-body slot and hard-codes type-to-confirm copy.
