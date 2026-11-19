# ConsoleShell gap table

`src/shell/Shell.tsx` renders the console frame through `ConsoleShell` from `@gntik-ai/templates`.
Every row was checked against the installed kit (`@gntik-ai/templates`, `blocks` and `ui` 0.15.0, `tokens` 0.5.0).

| Element (before) | Now | Status |
| --- | --- | --- |
| `ShellLink`, `LegacyLink`, `ContentLink`, `LinkProvider` | Unchanged; `LinkProvider` wraps `ConsoleShell` | confirmed in 0.14.0 (`NavList` reads the provider) |
| `matchRoutes`, `platformGlobal`, `ConsoleContextProvider`, `PermissionsProvider` | Unchanged | kept in Shell |
| `focusMainHeading` effect | Unchanged (`SidebarLayout` still renders `<main>`) | kept in Shell |
| `ShellErrorBoundary`, `Suspense`, `Outlet`, `StatusPage` | `ConsoleShell` children | kept in Shell |
| `SidebarLayout fullScreen` | Built into `ConsoleShell` | confirmed in 0.14.0 |
| `AppSidebar` nav groups, role visibility, `restrictedForAction` | `nav` (groups computed as before), `navLabel`, `sidebarLabel`, `currentHref` | confirmed in 0.14.0 |
| `MobileNav` and the `drawerOpen` state | `SidebarLayout` drawer, which renders `sidebarHeader` and `sidebarFooter` | confirmed in 0.14.0 |
| Drawer closes after a nav click (`onNavigate={closeDrawer}`) | `ConsoleShell` closes the drawer internally before forwarding `onNavigate` | resolved by 0.15.0 (gntik-ui#855) |
| Tenant `<select>` in `ContextPanel` | `tenants`, `currentTenantId`, `onTenantSelect`, `tenantLabel`, `tenantPlaceholder`, `tenantEmptyText` (kit `SimpleSelect`, clearable) | confirmed in 0.14.0 (Gap A) |
| `WorkspaceSwitcher` in `ContextPanel` | `workspaces`, `currentWorkspaceId`, `onWorkspaceChange`, `workspaceLabel`, `workspaceEmptyText`; no `onCreateWorkspace`, so "Create workspace" stays hidden | confirmed in 0.14.0 (Gap B) |
| Platform-global routes hide the context | `hideWorkspaceContext` | confirmed in 0.14.0 (Gap B) |
| Context `section` with `aria-label` and `aria-busy` | `contextRegionLabel`, `contextBusy` | confirmed in 0.14.0 (Gap C) |
| Read-only badge, error `role="status"` | `contextStatus` (rendered inside the region) | confirmed in 0.14.0 (Gap C) |
| `AppSidebar` `usage={null}`, `helpHref=""` | `usage={null}`, `helpHref={null}`; `ConsoleShell` forwards `undefined` to fixture defaults, so `null` is required | confirmed in 0.14.0 (Gap D) |
| `LayoutDashboard` icon | Dropped; kit default brand | confirmed in 0.14.0 (Gap E) |
| `AppTopbar` `environment`, `search`, `notifications` null | `topbar={{ environment: null, search: null, notifications: null }}` | confirmed in 0.14.0 |
| `AppTopbar` `user={null}` | `topbar.user: null`, otherwise `ConsoleShell` repeats the footer user menu in the topbar | confirmed in 0.14.0 |
| `Breadcrumbs` with `ContentLink` | `topbar.breadcrumb` node with `breadcrumbs={null}` (the `breadcrumbs` prop would not use `ContentLink`) | confirmed in 0.14.0 |
| Topbar theme control (`theme={null}`) | `topbar.theme: 'cycle'` with `topbar.themeOptions` limited to light and dark, bound to the existing `ThemeProvider` (`falcone-next-theme`, default dark). `userMenuShowTheme` stays `false` | resolved by 0.15.0 (gntik-ui#857); the built-in control receives the two theme options |
| Topbar Admin link | Removed; the superadmin Admin item is in `userMenuItems` | confirmed in 0.14.0 |
| `AccountMenu` `UserMenu` `user` | `user` (displayName, then username, then `shell.operator`) | confirmed in 0.14.0 (Gap D) |
| `AccountMenu` `triggerLabel` (`shell.userMenu`) | Kit default "Account menu for {name}" / "Menú de la cuenta de {name}" | named gap: `AppSidebarFooter` does not forward `triggerLabel` (Gap D `userMenuLabel`) |
| `AccountMenu` `signOutLabel` | Kit default "Sign out" / "Cerrar sesión" (same copy) | named gap: `AppSidebarFooter` does not forward `signOutLabel`; copy is unchanged |
| `AccountMenu` `showTheme={false}` | `userMenuShowTheme={false}` | confirmed in 0.14.0 |
| `AccountMenu` `onSignOut` with the local-sign-out fallback | `onSignOut` from `useAccountMenu` | confirmed in 0.14.0 |
| `AccountMenu` `items` (Admin, About) | `userMenuItems` | confirmed in 0.14.0 |
| `AccountMenu` `LocaleMenu` | `userMenuChildren` | confirmed in 0.14.0 |
| About `Dialog` | `useAccountMenu().aboutDialog`, rendered by Shell | kept in Shell |
| `AccountMenu` `mode="admin"` | Unchanged for `AdminLayout` (shares `useAccountMenu`) | kept in Shell |
| `className="console-shell"` | `ConsoleShell` has no `className`; `overview.tsx` finds the tenant picker through the sidebar or drawer | named gap: no `className` prop |
| Keyboard access to the scrolling `<main>` (previously guaranteed by the context controls inside it) | `mainLabel={t('shell.mainContent')}` names the overflowing kit main, which supplies its own tab stop and inset focus ring; a plain `p-4 sm:p-6` div preserves content padding | resolved by 0.15.0 (gntik-ui#857); no kit DOM is queried or rewritten |

The installed 0.15.0 `SidebarLayout` drawer renders `sidebarHeader` and `sidebarFooter`, so no `drawerFooter` gap is needed.

## 0.15.0 visual-review captures

`tests/parity/pages/console-shell.spec.mjs` attaches the following screenshots for the bump.
The dark captures show the closed drawer below lg and the sidebar at desktop width; the drawer captures show the open drawer below lg.
Screenshot assessment and baseline approval happen in the PR CI visual-review journey and at operator approval.
Only differences caused by the kit bump are eligible for approval.

| Screenshot attachment | Reason tied to 0.15.0 |
| --- | --- |
| `shell-dark-es-375` | Built-in topbar theme control replaces the search-slot workaround in the closed mobile frame (#857). |
| `shell-dark-en-375` | Built-in topbar theme control replaces the search-slot workaround in the closed mobile frame (#857). |
| `shell-dark-es-768` | Built-in topbar theme control replaces the search-slot workaround in the closed tablet frame (#857). |
| `shell-dark-en-768` | Built-in topbar theme control replaces the search-slot workaround in the closed tablet frame (#857). |
| `shell-dark-es-1280` | Built-in topbar theme control replaces the search-slot workaround in the desktop frame (#857). |
| `shell-dark-en-1280` | Built-in topbar theme control replaces the search-slot workaround in the desktop frame (#857). |
| `shell-light-es-375` | Kit themeOptions enables the light state after one click at mobile width (#857). |
| `shell-light-en-375` | Kit themeOptions enables the light state after one click at mobile width (#857). |
| `shell-light-es-768` | Kit themeOptions enables the light state after one click at tablet width (#857). |
| `shell-light-en-768` | Kit themeOptions enables the light state after one click at tablet width (#857). |
| `shell-light-es-1280` | Kit themeOptions enables the light state after one click at desktop width (#857). |
| `shell-light-en-1280` | Kit themeOptions enables the light state after one click at desktop width (#857). |
| `shell-main-focus-es-375` | Kit main owns the focus ring instead of the removed wrapper at mobile width (#857). |
| `shell-main-focus-en-375` | Kit main owns the focus ring instead of the removed wrapper at mobile width (#857). |
| `shell-main-focus-es-768` | Kit main owns the focus ring instead of the removed wrapper at tablet width (#857). |
| `shell-main-focus-en-768` | Kit main owns the focus ring instead of the removed wrapper at tablet width (#857). |
| `shell-main-focus-es-1280` | Kit main owns the focus ring instead of the removed wrapper at desktop width (#857). |
| `shell-main-focus-en-1280` | Kit main owns the focus ring instead of the removed wrapper at desktop width (#857). |
| `shell-drawer-es-375` | Kit owns the open mobile drawer and its close-on-navigation lifecycle (#855). |
| `shell-drawer-en-375` | Kit owns the open mobile drawer and its close-on-navigation lifecycle (#855). |
| `shell-drawer-es-768` | Kit owns the open tablet drawer and its close-on-navigation lifecycle (#855). |
| `shell-drawer-en-768` | Kit owns the open tablet drawer and its close-on-navigation lifecycle (#855). |

## CI follow-up

The reported `ui-parity-shards (28)` failure occurred before the fixture build or browser tests:
`playwright install --with-deps chromium` exited 100 because apt reported no installation candidate for `fonts-freefont-ttf`.
The Ubuntu 24.04 runner, Playwright 1.58.2 pin and browser installation command are unchanged from base `b11d1fde8820a56a08833922e089a167fda2dd37`.
The aggregate `ui-parity` job reported `SHARDS_RESULT: failure`; this log provides no shell assertion failure to repair.
Rerun the existing PR CI jobs to verify browser coverage after dependency installation succeeds; retain every shard and aggregate coverage assertion.
