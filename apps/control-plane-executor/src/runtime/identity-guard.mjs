// Startup policy only; main.mjs owns environment access, logging and process exit.
export function assertIdentityVerification({ jwtVerifier, env }) {
  if (jwtVerifier) return { mode: 'verified' };
  if (env.EXECUTOR_ALLOW_UNVERIFIED_IDENTITY === 'true') return { mode: 'unverified-dev' };
  const error = new Error('KEYCLOAK_JWKS_URL is required unless EXECUTOR_ALLOW_UNVERIFIED_IDENTITY is explicitly enabled for local development');
  error.code = 'EXECUTOR_JWT_VERIFIER_REQUIRED';
  throw error;
}
