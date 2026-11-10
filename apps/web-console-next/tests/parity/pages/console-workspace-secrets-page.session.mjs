// Playwright init scripts cannot be removed once added, so a per-navigation override cannot be an init script of
// its own: it would leak into every later navigation of the same page. One script is installed per test and reads
// the override from a cookie that the harness rewrites before each navigation (see setOverrides in the support file).
// Playwright does not guarantee the order of page and harness init scripts, so the override is applied after they
// finish, before the deferred application modules run.
export function seedSecretsOverrides(cookieName) {
  const entry = document.cookie.split('; ').find((cookie) => cookie.startsWith(`${cookieName}=`));
  const overrides = entry ? JSON.parse(decodeURIComponent(entry.slice(cookieName.length + 1))) : {};
  if (!overrides.principal && !overrides.active) return;
  document.addEventListener('readystatechange', () => {
    if (document.readyState !== 'interactive') return;
    const key = 'in-falcone.console-shell-session';
    const session = JSON.parse(sessionStorage.getItem(key));
    if (overrides.principal) {
      Object.assign(session.principal, overrides.principal);
      sessionStorage.setItem(key, JSON.stringify(session));
    }
    // The harness clears the stored context before every navigation; a switch scenario restores the first workspace.
    if (overrides.active) {
      localStorage.setItem('in-falcone.console-active-context', JSON.stringify({ userId: session.principal.userId, tenantId: 'synthetic-tenant', workspaceId: overrides.active, updatedAt: '2026-01-01' }));
    }
  }, { once: true });
}
