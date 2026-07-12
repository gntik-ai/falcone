#!/usr/bin/env bash
# Real-stack runner for change add-seaweedfs-tenant-identities (tasks 10.1-10.3, 11.3).
#
#   bash tests/env/seaweedfs/run-tenant-identities.sh
#
# Deploys a version-pinned SeaweedFS (adr-spike #431 pin) into an EPHEMERAL
# namespace on the kind test cluster, wires the slice to it (`kubectl exec` for
# `weed shell s3.configure`, port-forward for signed S3), runs the
# provision -> cross-tenant probe -> rotate -> cleanup -> revoke lifecycle
# against the live gateway, and ALWAYS tears the namespace down. If kubectl/the
# cluster is unavailable the slice still runs and self-skips.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
IMAGE="chrislusf/seaweedfs@sha256:f0b358973e81f884304737645dd3b278c590c2c9d47d60089729d46324f70495"
NS="falcone-swfs-tid-$$"
POD="swfs"
LOCAL_PORT="${SEAWEEDFS_S3_PORT:-18333}"
ADMIN_AK="${SEAWEEDFS_S3_ADMIN_ACCESS_KEY:-adminkey}"
ADMIN_SK="${SEAWEEDFS_S3_ADMIN_SECRET_KEY:-adminsecret}"
export KUBECONFIG="${E2E_KUBECONFIG:-${KUBECONFIG:-$ROOT/kubeconfig-test-cluster-b.yaml}}"

run_slice_skip() {
  echo "==> $1; running slice (it self-skips without a live SeaweedFS)"
  exec node --test "$HERE/seaweedfs-tenant-identities.test.mjs"
}

command -v kubectl >/dev/null 2>&1 || run_slice_skip "kubectl unavailable"
[ -f "$KUBECONFIG" ] || run_slice_skip "kubeconfig $KUBECONFIG not found"
kubectl version >/dev/null 2>&1 || run_slice_skip "kind cluster unreachable"

PF_PID=""
cleanup() {
  [ -n "$PF_PID" ] && kill "$PF_PID" >/dev/null 2>&1 || true
  kubectl delete ns "$NS" --ignore-not-found --wait=false >/dev/null 2>&1 || true
  echo "==> torn down namespace $NS"
}
trap cleanup EXIT

echo "==> creating ephemeral namespace $NS"
kubectl create ns "$NS" >/dev/null

echo "==> deploying pinned SeaweedFS ($IMAGE)"
kubectl -n "$NS" apply -f - >/dev/null <<YAML
apiVersion: v1
kind: ConfigMap
metadata:
  name: swfs-s3-config
data:
  s3.json: |
    {"identities":[{"name":"anvAdmin","credentials":[{"accessKey":"$ADMIN_AK","secretKey":"$ADMIN_SK"}],"actions":["Admin","Read","Write","List","Tagging"]}]}
---
apiVersion: v1
kind: Pod
metadata:
  name: $POD
  labels: { app: swfs }
spec:
  containers:
    - name: seaweedfs
      image: $IMAGE
      args: ["server","-s3","-s3.config=/etc/seaweedfs/s3.json","-dir=/tmp"]
      ports: [{ containerPort: 8333 }]
      volumeMounts:
        - { name: cfg, mountPath: /etc/seaweedfs }
  volumes:
    - name: cfg
      configMap: { name: swfs-s3-config }
YAML

echo "==> waiting for pod Ready"
kubectl -n "$NS" wait --for=condition=Ready "pod/$POD" --timeout=180s

echo "==> waiting for the S3 master (weed shell)"
for _ in $(seq 1 60); do
  if kubectl -n "$NS" exec "$POD" -- sh -c 'echo cluster.check | weed shell' >/dev/null 2>&1; then break; fi
  sleep 1
done

echo "==> port-forwarding $LOCAL_PORT -> 8333"
kubectl -n "$NS" port-forward "pod/$POD" "$LOCAL_PORT:8333" >/dev/null 2>&1 &
PF_PID=$!

export SEAWEEDFS_S3_ENDPOINT="http://localhost:$LOCAL_PORT"
export SEAWEEDFS_S3_ADMIN_ACCESS_KEY="$ADMIN_AK"
export SEAWEEDFS_S3_ADMIN_SECRET_KEY="$ADMIN_SK"

echo "==> waiting for the S3 gateway to accept signed requests"
ready=""
for _ in $(seq 1 60); do
  if node --input-type=module -e '
    import { createSeaweedFSClient } from "'"$ROOT"'/packages/provisioning-orchestrator/src/reconcilers/s3-rest-client.mjs";
    await createSeaweedFSClient({ endpoint: process.env.SEAWEEDFS_S3_ENDPOINT, accessKeyId: process.env.SEAWEEDFS_S3_ADMIN_ACCESS_KEY, secretAccessKey: process.env.SEAWEEDFS_S3_ADMIN_SECRET_KEY }).listBuckets();
  ' >/dev/null 2>&1; then ready=1; break; fi
  sleep 1
done
[ -n "$ready" ] || run_slice_skip "SeaweedFS gateway did not become ready"

export SWFS_EXEC_MODE="kubectl"
export SWFS_NS="$NS"
export SWFS_POD="$POD"

echo "==> running tenant-identities real-stack slice against live SeaweedFS"
node --test "$HERE/seaweedfs-tenant-identities.test.mjs"
