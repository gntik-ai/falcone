# ConsoleShell gap table

`src/shell/Shell.tsx` renders the console frame through `ConsoleShell` from `@gntik-ai/templates`.
Every row was checked against the installed kit (`@gntik-ai/templates`, `blocks` and `ui` 0.14.0, `tokens` 0.5.0).

| Element (before) | Now | Status |
| --- | --- | --- |
| `ShellLink`, `LegacyLink`, `ContentLink`, `LinkProvider` | Unchanged; `LinkProvider` wraps `ConsoleShell` | confirmed in 0.14.0 (`NavList` reads the provider) |
| `matchRoutes`, `platformGlobal`, `ConsoleContextProvider`, `PermissionsProvider` | Unchanged | kept in Shell |
| `focusMainHeading` effect | Unchanged (`SidebarLayout` still renders `<main>`) | kept in Shell |
| `ShellErrorBoundary`, `Suspense`, `Outlet`, `StatusPage` | `ConsoleShell` children | kept in Shell |
| `SidebarLayout fullScreen` | Built into `ConsoleShell` | confirmed in 0.14.0 |
| `AppSidebar` nav groups, role visibility, `restrictedForAction` | `nav` (groups computed as before), `navLabel`, `sidebarLabel`, `currentHref` | confirmed in 0.14.0 |
| `MobileNav` and the `drawerOpen` state | `SidebarLayout` drawer, which renders `sidebarHeader` and `sidebarFooter` | confirmed in 0.14.0 |
| Drawer closes after a nav click (`onNavigate={closeDrawer}`) | `CloseDrawerOnNavigate` (public `useSidebarLayout`) | temporary adapter, removed with gntik-ui#855 (`ConsoleShell` renders `AppSidebarNav` without `onNavigate`) |
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
| Topbar theme control (`theme={null}`) | `topbar.theme: 'cycle'`, bound to the existing `ThemeProvider` (`falcone-next-theme`, default dark). `userMenuShowTheme` stays `false` | confirmed in 0.14.0; `ThemeCycleButton` cycles light, dark, high contrast and system because `AppTopbar` has no `themeOptions` |
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
| Keyboard access to the scrolling `<main>` (previously guaranteed by the context controls inside it) | The content wrapper `Shell` renders as `<main>`'s child is itself a tab stop (`tabIndex={0}`), so the scroll region always holds one keyboard stop; no kit DOM is queried or rewritten | confirmed: no kit change needed; `SidebarLayout` `<main tabindex="-1">` stays as is |

Open question from the OpenSpec: the installed 0.14.0 `SidebarLayout` drawer does render `sidebarHeader` and `sidebarFooter`, so no `drawerFooter` gap is needed.
