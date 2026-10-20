import { secretEnvVarName } from './vault-secrets.mjs';

// A value-free representation shared by the registry, snapshots, and API handlers.
export function normalizeFunctionSecretRefs(refs = []) {
  if (!Array.isArray(refs)) throw new TypeError('execution.secrets must be an array');
  const names = new Map();
  return refs.map((ref) => {
    const name = typeof ref === 'string' ? ref : (ref?.name ?? ref?.secretName);
    const env = (typeof ref === 'object' && (ref?.env ?? ref?.mountAlias)) || secretEnvVarName(name);
    if (!/^[a-z][a-z0-9_-]{0,62}$/.test(name ?? '') || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(env ?? '') || names.has(env)) {
      throw new TypeError('Invalid or duplicate workspace secret env mapping');
    }
    names.set(env, name);
    return { name, env };
  });
}

export function functionSecretRefs(row) {
  return row?.secret_refs ?? row?.execution?.secrets ?? row?.secrets ?? row?.parameters?.execution?.secrets ?? [];
}
