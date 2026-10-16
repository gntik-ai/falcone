// Shared JWT/trusted-header binding rule. Callers translate absent headers to undefined;
// claims are absent only when null or undefined. Never coerce credential values.
const isWorkspaceToken = (value) => typeof value === 'string' && /^[^\s,]+$/.test(value);

export function normalizeWorkspaceBinding(singular, plural) {
  const invalid = { valid: false, singular: undefined, plural: undefined };
  const normalizedSingular = singular ?? undefined;
  if (normalizedSingular !== undefined && !isWorkspaceToken(normalizedSingular)) return invalid;
  let normalizedPlural;
  if (plural != null) {
    let tokens;
    if (Array.isArray(plural)) tokens = [...plural];
    else if (typeof plural === 'string') tokens = plural.trim().split(/[ ,]+/).filter(Boolean);
    else return invalid;
    if (!tokens.every(isWorkspaceToken)) return invalid;
    normalizedPlural = [...new Set(tokens)];
  }
  if (normalizedSingular !== undefined && normalizedPlural !== undefined
      && (normalizedPlural.length !== 1 || normalizedPlural[0] !== normalizedSingular)) return invalid;
  return { valid: true, singular: normalizedSingular, plural: normalizedPlural };
}
