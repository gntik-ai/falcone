import { config } from './config.mjs';

export async function fetchEnabledCapabilities(workspaceId, authToken) {
  const url = `${config.effectiveCapabilitiesBaseUrl}/v1/workspaces/${workspaceId}/effective-capabilities`;
  const res = await fetch(url, {
    headers: authToken ? { Authorization: `Bearer ${authToken}` } : {}
  });

  if (!res.ok) {
    throw new Error(`capabilities fetch failed: ${res.status}`);
  }

  const body = await res.json();
  return new Set(body.capabilities ?? []);
}
