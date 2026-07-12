# add-mcp-workflows-as-tools — throwaway verification (issue #395)

EPHEMERAL. Not production code. Evidence that the flow→MCP-Tasks mapping
(`apps/control-plane-executor/src/mcp-workflows-tools.mjs`) reflects the real Temporal workflow lifecycle:
a tool invocation **starts a durable workflow** and the returned **Task handle is keyed by the
workflow id**, and the workflow's status maps to an **MCP Task status**.

Temporal is not on `test-cluster-b` by default, so the spike deploys a throwaway Temporal dev
server (`temporal server start-dev`, see `temporal-dev.yaml`) and drives it with the
`@temporalio/client` shipped in the production `workflow-worker` image (`spike-flow-task.mjs`).
No worker is registered on the `flows` task queue, so `RUNNING → working` is the expected bounded
state of this proof (the durable run exists; completion rides the real worker in production —
ADR-11). See `evidence/flow-task-lifecycle.txt`.

## What it proves

- `taskHandleFromExecution`: the MCP Task id **is** the durable workflow/execution id.
- `mapExecutionToTaskStatus`: a live `RUNNING` Temporal status maps to the MCP Task `working` state
  (the same module unit-tests the `completed`/`failed`/`cancelled` branches).
- The start→handle→poll shape is exactly the flows executions API the production mapping targets.

## Run (test-cluster-b)

```sh
export KUBECONFIG=$PWD/kubeconfig-test-cluster-b.yaml
kubectl create ns mcp-temporal-spike
kubectl apply -n mcp-temporal-spike -f spikes/add-mcp-workflows-as-tools/temporal-dev.yaml
kubectl wait --for=condition=Available deploy/temporal-dev -n mcp-temporal-spike --timeout=120s
# client pod from the worker image (ships @temporalio/client):
kubectl run spike-client -n mcp-temporal-spike --restart=Never \
  --image=localhost:30500/in-falcone-workflow-worker:0.1.0-flows-e2e --command -- sleep 3600
kubectl cp spikes/add-mcp-workflows-as-tools/spike-flow-task.mjs \
  mcp-temporal-spike/spike-client:/tmp/spike-flow-task.mjs
kubectl exec -n mcp-temporal-spike spike-client -- \
  env TEMPORAL_ADDRESS=temporal-dev:7233 node /tmp/spike-flow-task.mjs
kubectl delete ns mcp-temporal-spike   # always torn down
```
