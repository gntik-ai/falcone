// Tenant-ownership binding for the secret-rotation lifecycle (bug-001 fix).
//
// The role gate (`allowed`) only proves the caller may act *in its own tenant*.
// It does NOT prove that the operated `secretPath` belongs to that tenant — the
// two are independent caller inputs. These helpers resolve the recorded owner of
// `secretPath` and bind it to the verified principal so a tenant can never rotate
// or revoke another tenant's secret.

// Secret paths follow the convention `<domain>/<tenantId?>/<name...>`:
//   tenant secrets:   `tenant/<tenantId>/<name>`
//   platform secrets: `platform|gateway|iam|functions/<name...>`
export function parseSecretPathOwner(secretPath) {
  const segments = String(secretPath ?? '').split('/').filter(Boolean);
  const domain = segments[0] ?? null;
  const tenantId = domain === 'tenant' ? (segments[1] ?? null) : null;
  return { domain, tenantId };
}

const FORBIDDEN = { code: 'TENANT_ISOLATION_VIOLATION', status: 403 };

// Resolves the operated secret's owner and asserts it matches the verified caller.
// Returns `{ ownerTenantId }` on success (null for platform-scoped secrets) or
// `{ error: { code, status } }` to be returned verbatim by the action — always
// BEFORE any Vault call or state mutation.
export async function assertSecretRotationOwnership({ auth, secretPath, domain, tenantId, dataRepo, db }) {
  if (typeof secretPath !== 'string' || secretPath.trim() === '') {
    return { error: { code: 'INVALID_SECRET_PATH', status: 400 } };
  }

  const parsed = parseSecretPathOwner(secretPath);
  // The path's own domain segment must match the declared domain.
  if (parsed.domain !== domain) return { error: FORBIDDEN };

  // Prefer the authoritative record in `secret_metadata`; fall back to the path
  // convention when no owner row exists or the repo does not expose the lookup.
  const recorded = typeof dataRepo?.getSecretOwner === 'function'
    ? await dataRepo.getSecretOwner(db, secretPath)
    : null;
  const ownerDomain = recorded?.domain ?? parsed.domain;
  const ownerTenantId = recorded ? (recorded.tenant_id ?? null) : parsed.tenantId;

  if (ownerDomain !== domain) return { error: FORBIDDEN };

  // Tenant-scoped secrets: the recorded owner tenant MUST equal the trusted
  // principal tenant. `auth.tenantId` is trusted; `secretPath`/`tenantId` are not.
  if (domain === 'tenant' && (!auth?.tenantId || ownerTenantId !== auth.tenantId)) {
    return { error: FORBIDDEN };
  }

  return { ownerTenantId };
}
