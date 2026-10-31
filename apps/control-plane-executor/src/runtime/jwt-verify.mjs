import { createRealmTokenVerifier } from '../../../../packages/internal-contracts/src/jwt-trust-policy.mjs';
export { deriveRealmTopology, tenantAudienceOptionsFromEnv, jwtVerifierOptionsFromEnv } from '../../../../packages/internal-contracts/src/jwt-trust-policy.mjs';
import { normalizeWorkspaceBinding } from '../../../../packages/internal-contracts/src/workspace-binding.mjs';

// Mirror control-plane deriveActorType, including claim precedence. This mapping grants
// platform scope only after issuer trust and signature validation below.
const KNOWN_ROLE_TO_ACTORTYPE = [
  ['superadmin', 'superadmin'], ['platform_admin', 'superadmin'], ['platform_operator', 'internal'],
  ['tenant_owner', 'tenant_owner'], ['tenant_admin', 'tenant_owner'],
  ['workspace_admin', 'workspace_admin'], ['workspace_owner', 'workspace_admin']
];
function deriveActorType(claims) {
  if (claims.actor_type) return claims.actor_type;
  const roles = claims?.realm_access?.roles ?? [];
  for (const [role, type] of KNOWN_ROLE_TO_ACTORTYPE) if (roles.includes(role)) return type;
  return 'tenant_member';
}

export function deriveIdentityFromClaims(claims, pathWorkspaceId) {
  const roles = claims.realm_access?.roles ?? [];
  const scopes = typeof claims.scope === 'string'
    ? claims.scope.split(' ').filter(Boolean)
    : (Array.isArray(claims.scopes) ? claims.scopes : []);
  // credentialWorkspaceId is set only when the JWT explicitly carries a workspace_id claim.
  // A tenant-only token (no workspace_id claim) leaves credentialWorkspaceId undefined,
  // which suppresses the path↔credential workspace binding check (the token is not
  // workspace-scoped and must not be rejected for addressing a specific workspace path).
  const binding = normalizeWorkspaceBinding(claims.workspace_id, claims.workspace_ids);
  const credentialWorkspaceId = binding.singular;
  const workspaceIds = binding.valid
    ? binding.plural ?? (credentialWorkspaceId === undefined ? undefined : [credentialWorkspaceId])
    : [];
  return {
    tenantId: claims.tenant_id ?? undefined,
    workspaceId: binding.valid ? credentialWorkspaceId ?? pathWorkspaceId : null,
    ...(credentialWorkspaceId !== undefined ? { credentialWorkspaceId } : {}),
    ...(!binding.valid ? { invalidWorkspaceBinding: true } : {}),
    actorId: claims.sub,
    roleName: 'falcone_app', // a user/admin JWT is not an api-key → no SET ROLE / RLS dbRole
    roles,
    scopes,
    ...(workspaceIds !== undefined ? { workspaceIds } : {}),
  };
}

// Preserve the executor identity API while sharing every verification decision.
export function createJwtVerifier(options = {}) {
  const verifier = createRealmTokenVerifier(options);
  if (!options.jwksUrl) return undefined;
  return {
    async verify(token, pathWorkspaceId) {
      const { payload: claims, trust } = await verifier.verify(token);
      const identity = deriveIdentityFromClaims(claims, pathWorkspaceId);
      if (trust.kind === 'tenant') identity.tenantId = trust.realm;
      if (trust.kind === 'platform') {
        identity.actorType = deriveActorType(claims);
        identity.platformCaller = identity.actorType === 'superadmin' || identity.actorType === 'internal';
      }
      return identity;
    },
  };
}
