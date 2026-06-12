// EPHEMERAL SPIKE — not production code.
// Trivial tenancy workflow for Spike B. Returns immediately; the spike measures fleet/topology
// (pollers, gRPC connections) and visibility filtering, not workflow logic.
export async function tenantPing(input) {
  return { tenantId: input.tenantId, ok: true };
}
