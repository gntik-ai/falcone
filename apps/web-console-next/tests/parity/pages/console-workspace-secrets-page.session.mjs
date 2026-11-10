// Playwright does not guarantee the order of page and harness init scripts.
// Apply the override after they finish, before the deferred application modules run.
export function seedSecretsPrincipal(principal) {
  document.addEventListener('readystatechange', () => {
    if (document.readyState !== 'interactive') return;
    const key = 'in-falcone.console-shell-session';
    const session = JSON.parse(sessionStorage.getItem(key));
    Object.assign(session.principal, principal);
    sessionStorage.setItem(key, JSON.stringify(session));
  }, { once: true });
}

// The harness clears the stored context before every navigation; a switch scenario restores the first workspace.
export function seedActiveWorkspace(workspaceId) {
  document.addEventListener('readystatechange', () => {
    if (document.readyState !== 'interactive') return;
    const session = JSON.parse(sessionStorage.getItem('in-falcone.console-shell-session'));
    localStorage.setItem('in-falcone.console-active-context', JSON.stringify({ userId: session.principal.userId, tenantId: 'synthetic-tenant', workspaceId, updatedAt: '2026-01-01' }));
  }, { once: true });
}
