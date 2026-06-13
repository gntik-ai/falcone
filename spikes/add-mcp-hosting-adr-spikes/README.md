# add-mcp-hosting-adr-spikes — throwaway de-risking spikes

**EPHEMERAL. Not production code.** These spikes exist only to gather evidence for the
MCP-hosting ADR (issue #387, epic #386), mirroring `spikes/add-flows-adr-temporal-spikes/`.
They are safe to delete once the ADR records the decisions.

## Spikes

- `runtime/` — **spike (a): runtime + scale-to-zero.** A minimal MCP-shaped server
  (Streamable-HTTP JSON-RPC: `initialize`, `tools/list`, `tools/call`) deployed as a **Knative
  ksvc** in a per-tenant namespace on the `test-cluster-b` kind cluster, to prove the recommended
  runtime (reuse Falcone's existing Knative per-tenant functions runtime: each MCP server = a ksvc,
  HTTP invocation, scale-to-zero for free). Evidence captured under `runtime/evidence/`.

## How to run (kind: test-cluster-b)

```bash
export KUBECONFIG=$PWD/kubeconfig-test-cluster-b.yaml
bash spikes/add-mcp-hosting-adr-spikes/runtime/run.sh
```

## Findings (filled in as spikes run)

See `runtime/evidence/`. Note: the kind cluster's CNI is **kindnet**, which does **not enforce
NetworkPolicy** — so network-level cross-namespace isolation must be validated on a policy-enforcing
CNI (Calico/Cilium); this is recorded in the ADR as a deployment requirement, not assumed.
