// Both documents use the same synthetic shell identity; only next supports locale selection.
export function seedDesignerPrincipal(principal) {
  document.addEventListener('readystatechange', () => {
    if (document.readyState !== 'interactive') return;
    const key = 'in-falcone.console-shell-session';
    const session = JSON.parse(sessionStorage.getItem(key));
    Object.assign(session.principal, principal);
    sessionStorage.setItem(key, JSON.stringify(session));
  }, { once: true });
}
