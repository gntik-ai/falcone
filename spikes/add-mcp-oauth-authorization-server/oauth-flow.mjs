// EPHEMERAL SPIKE — proves Keycloak can act as the OAuth 2.1 AS for MCP:
// model a per-tool scope as a Keycloak client scope, register a client, and issue a
// client_credentials token that CARRIES that per-tool scope. Uses an ISOLATED throwaway
// realm and deletes it at the end. NOT production code. Creds via env (KC_USER/KC_PASS).
const KC = process.env.KC_BASE || 'http://falcone-keycloak.falcone.svc.cluster.local:8080';
const REALM = 'mcp-oauth-spike';
const SCOPE = 'mcp:tool:echo';
const form = (o) => new URLSearchParams(o).toString();
const j = (r) => r.text().then((t) => { try { return JSON.parse(t); } catch { return t; } });

async function adminToken() {
  const r = await fetch(`${KC}/realms/master/protocol/openid-connect/token`, {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: form({ grant_type: 'password', client_id: 'admin-cli', username: process.env.KC_USER, password: process.env.KC_PASS }),
  });
  const b = await j(r); if (!b.access_token) throw new Error('admin token failed: ' + JSON.stringify(b));
  return b.access_token;
}
const adm = (t) => ({ authorization: `Bearer ${t}`, 'content-type': 'application/json' });

(async () => {
  const log = (...a) => console.log(...a);
  let tok;
  try {
    tok = await adminToken(); log('STEP admin-token: OK');

    await fetch(`${KC}/admin/realms/${REALM}`, { method: 'DELETE', headers: adm(tok) }); // best-effort pre-clean
    let r = await fetch(`${KC}/admin/realms`, { method: 'POST', headers: adm(tok), body: JSON.stringify({ realm: REALM, enabled: true }) });
    log('STEP create-realm:', r.status);

    r = await fetch(`${KC}/admin/realms/${REALM}/client-scopes`, { method: 'POST', headers: adm(tok), body: JSON.stringify({
      name: SCOPE, protocol: 'openid-connect',
      attributes: { 'include.in.token.scope': 'true', 'display.on.consent.screen': 'true', 'consent.screen.text': 'Call the echo tool' },
    }) });
    log('STEP create-client-scope (per-tool):', r.status);

    r = await fetch(`${KC}/admin/realms/${REALM}/clients`, { method: 'POST', headers: adm(tok), body: JSON.stringify({
      clientId: 'mcp-spike-client', protocol: 'openid-connect', publicClient: false,
      serviceAccountsEnabled: true, standardFlowEnabled: false,
      redirectUris: ['https://example.com/callback'],
    }) });
    log('STEP create-client:', r.status);
    const clients = await j(await fetch(`${KC}/admin/realms/${REALM}/clients?clientId=mcp-spike-client`, { headers: adm(tok) }));
    const cid = clients[0].id;
    const scopes = await j(await fetch(`${KC}/admin/realms/${REALM}/client-scopes`, { headers: adm(tok) }));
    const sid = scopes.find((s) => s.name === SCOPE).id;
    r = await fetch(`${KC}/admin/realms/${REALM}/clients/${cid}/default-client-scopes/${sid}`, { method: 'PUT', headers: adm(tok) });
    log('STEP assign per-tool scope as default:', r.status);
    const secret = (await j(await fetch(`${KC}/admin/realms/${REALM}/clients/${cid}/client-secret`, { headers: adm(tok) }))).value;

    const tr = await j(await fetch(`${KC}/realms/${REALM}/protocol/openid-connect/token`, {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: form({ grant_type: 'client_credentials', client_id: 'mcp-spike-client', client_secret: secret }),
    }));
    if (!tr.access_token) throw new Error('client token failed: ' + JSON.stringify(tr));
    const claims = JSON.parse(Buffer.from(tr.access_token.split('.')[1], 'base64').toString());
    log('STEP client_credentials token: OK');
    log('RESULT token.scope =', JSON.stringify(claims.scope));
    log('RESULT per-tool scope present =', String(claims.scope || '').split(' ').includes(SCOPE));
  } catch (e) {
    log('ERROR', e.message);
  } finally {
    if (tok) { await fetch(`${KC}/admin/realms/${REALM}`, { method: 'DELETE', headers: adm(tok) }); log('CLEANUP delete-realm: done'); }
  }
})();
