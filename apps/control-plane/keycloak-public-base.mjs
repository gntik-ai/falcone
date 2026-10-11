export function keycloakPublicBase(env = process.env) {
  try {
    const issuer = new URL(env.KEYCLOAK_ISSUER);
    const realm = issuer.pathname.match(/\/realms\/[^/]+\/?$/);
    if (['https:', 'http:'].includes(issuer.protocol) && !issuer.username && !issuer.password && realm) {
      return issuer.origin + issuer.pathname.slice(0, realm.index);
    }
  } catch { /* unset or invalid public issuer */ }
  return null;
}
