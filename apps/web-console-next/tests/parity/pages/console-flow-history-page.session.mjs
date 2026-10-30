// Playwright does not guarantee the order of page and harness init scripts.
// Apply the override after they finish, before the deferred application modules run.
export function seedHistoryPrincipal(principal) {
  document.addEventListener('readystatechange', () => {
    if (document.readyState !== 'interactive') return;
    const key = 'in-falcone.console-shell-session';
    const session = JSON.parse(sessionStorage.getItem(key));
    Object.assign(session.principal, principal);
    sessionStorage.setItem(key, JSON.stringify(session));
  }, { once: true });
}
