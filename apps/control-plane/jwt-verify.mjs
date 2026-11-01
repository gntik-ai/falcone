// Keep the public verifier API; both runtimes use the same trust policy.
export { createRealmTokenVerifier as createMultiRealmVerifier, deriveRealmTopology, jwtVerifierOptionsFromEnv, tenantAudienceOptionsFromEnv } from '../../packages/internal-contracts/src/jwt-trust-policy.mjs';
