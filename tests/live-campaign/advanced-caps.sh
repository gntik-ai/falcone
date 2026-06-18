#!/usr/bin/env bash
# Bring up the ADVANCED capability surface (Flows/Temporal, MCP hosting, realtime SSE) on the
# live campaign install. Reproduces the proven live setup from the archived change
# add-kind-profile-advanced-capabilities: a dev Temporal server + the workflow-worker + the
# executor wired with TEMPORAL_ADDRESS + MCP_ENABLED. Idempotent.
set -uo pipefail
ROOT="$(git rev-parse --show-toplevel)"; export KUBECONFIG="$ROOT/kubeconfig-test-cluster-b.yaml"
NS=falcone; TAG="${CAMPAIGN_TAG:-campaign-20260617}"; REG=localhost:30500
TQ_NS=falcone-flows; FRONTEND=falcone-temporal-frontend

echo "== 1/4 temporal dev server =="
cat <<YAML | kubectl apply -f -
apiVersion: apps/v1
kind: Deployment
metadata: { name: temporal-dev, namespace: $NS, labels: { app: temporal-dev } }
spec:
  replicas: 1
  selector: { matchLabels: { app: temporal-dev } }
  template:
    metadata: { labels: { app: temporal-dev, "app.kubernetes.io/component": flows-temporal } }
    spec:
      containers:
        - name: temporal
          image: docker.io/temporalio/admin-tools:1.31.1
          command: ["temporal","server","start-dev","--ip","0.0.0.0","--port","7233","--http-port","7234","--ui-port","8233","--namespace","$TQ_NS","--log-level","warn"]
          ports: [{ containerPort: 7233 }, { containerPort: 8233 }]
          readinessProbe: { tcpSocket: { port: 7233 }, initialDelaySeconds: 5, periodSeconds: 5 }
---
apiVersion: v1
kind: Service
metadata: { name: $FRONTEND, namespace: $NS }
spec:
  selector: { app: temporal-dev }
  ports: [{ name: grpc, port: 7233, targetPort: 7233 }, { name: ui, port: 8233, targetPort: 8233 }]
YAML
kubectl -n $NS rollout status deploy/temporal-dev --timeout=180s 2>&1 | tail -1

echo "== 1b/4 register the 5 custom search attributes (Keyword) =="
# `temporal server start-dev` does NOT register the flow executor's custom search attributes,
# so the concurrency pre-flight (workflow.list filtered by these) 500'd before any run
# (BUG-TEMPORAL-SEARCH-ATTRS). Register them idempotently against the dev frontend.
for _sa in tenantId workspaceId flowId flowVersion triggerType; do
  kubectl -n $NS exec deploy/temporal-dev -- \
    temporal operator search-attribute create --namespace "$TQ_NS" --name "$_sa" --type Keyword 2>&1 | tail -1 || true
done

echo "== 2/4 workflow-worker (fresh image, Always) =="
cat <<YAML | kubectl apply -f -
apiVersion: apps/v1
kind: Deployment
metadata: { name: falcone-workflow-worker, namespace: $NS, labels: { "app.kubernetes.io/name": workflow-worker } }
spec:
  replicas: 1
  selector: { matchLabels: { "app.kubernetes.io/name": workflow-worker } }
  template:
    metadata: { labels: { "app.kubernetes.io/name": workflow-worker, "app.kubernetes.io/component": flows-worker } }
    spec:
      containers:
        - name: worker
          image: $REG/in-falcone-workflow-worker:$TAG
          imagePullPolicy: Always
          env:
            - { name: TEMPORAL_ADDRESS, value: "$FRONTEND:7233" }
            - { name: TEMPORAL_NAMESPACE, value: "$TQ_NS" }
            - { name: TEMPORAL_TASK_QUEUE, value: "flows-main" }
            - { name: WORKER_HEALTH_PORT, value: "8080" }
            # Postgres wiring for the db.query activity (BUG-WORKER-PG-ENV): without these the
            # worker-deps DSN fell back to localhost/falcone_app and db.query → UPSTREAM_UNAVAILABLE.
            # PGDATABASE is in_falcone (matches the executor) so the workspace_databases registry
            # resolves and per-workspace wsdb_* routing works.
            - { name: PGHOST, value: "falcone-postgresql" }
            - { name: PGPORT, value: "5432" }
            - { name: PGUSER, value: "falcone" }
            - { name: PGDATABASE, value: "in_falcone" }
            - { name: PGPASSWORD, valueFrom: { secretKeyRef: { name: in-falcone-postgresql, key: POSTGRESQL_PASSWORD } } }
          ports: [{ containerPort: 8080 }]
YAML
kubectl -n $NS rollout status deploy/falcone-workflow-worker --timeout=180s 2>&1 | tail -1

echo "== 3/4 patch executor env: TEMPORAL_ADDRESS + MCP_ENABLED + MCP_SELF_BASE_URL =="
# MCP_SELF_BASE_URL pins the tool-call self-call to the executor's own HTTP server so a published
# MCP tool-call reaches the real data-plane route (or proxies upstream) instead of the executor
# index (#565). Set alongside MCP_ENABLED — the same patch that registers the /v1/mcp routes.
kubectl -n $NS set env deploy/falcone-cp-executor \
  TEMPORAL_ADDRESS="$FRONTEND:7233" TEMPORAL_NAMESPACE="$TQ_NS" TEMPORAL_TASK_QUEUE="flows-main" \
  MCP_ENABLED="true" MCP_SELF_BASE_URL="http://127.0.0.1:8080" 2>&1 | tail -1
kubectl -n $NS rollout status deploy/falcone-cp-executor --timeout=180s 2>&1 | tail -1

echo "== 4/4 worker + temporal logs =="
kubectl -n $NS logs deploy/falcone-workflow-worker --tail=8 2>&1 | tail -8
echo "DONE"
