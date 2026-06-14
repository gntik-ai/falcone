#!/usr/bin/env bash
# Real-SeaweedFS runner for the bucket-reconciliation slice
# (change add-seaweedfs-bucket-lifecycle-migration).
#
#   bash tests/env/seaweedfs/run.sh
#
# Boots an ephemeral, version-pinned SeaweedFS S3 gateway (adr-spike #431 pin),
# exports its endpoint + a static identity, runs the reconciliation slice, and
# ALWAYS tears the container down. If docker is unavailable the test still runs
# and self-skips (so this is safe in CI without docker).
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Pinned in spikes/add-seaweedfs-storage-adr-spike (SeaweedFS 4.33).
IMAGE="chrislusf/seaweedfs@sha256:f0b358973e81f884304737645dd3b278c590c2c9d47d60089729d46324f70495"
NAME="falcone-swfs-it"
PORT="${SEAWEEDFS_S3_PORT:-8333}"
ACCESS="${SEAWEEDFS_S3_ACCESS_KEY_ID:-falcone}"
SECRET="${SEAWEEDFS_S3_SECRET_ACCESS_KEY:-falconesecret}"

if ! command -v docker >/dev/null 2>&1; then
  echo "==> docker unavailable; running slice (it will self-skip without a SeaweedFS endpoint)"
  exec node --test "$HERE"/seaweedfs-reconcile.test.mjs
fi

cleanup() { docker rm -f "$NAME" >/dev/null 2>&1 || true; rm -f "$CFG" 2>/dev/null || true; }
trap cleanup EXIT
docker rm -f "$NAME" >/dev/null 2>&1 || true

CFG="$(mktemp)"
cat > "$CFG" <<JSON
{ "identities": [ { "name": "falcone", "credentials": [ { "accessKey": "$ACCESS", "secretKey": "$SECRET" } ], "actions": ["Admin", "Read", "Write", "List", "Tagging"] } ] }
JSON

echo "==> starting SeaweedFS ($IMAGE) S3 gateway on :$PORT"
docker run -d --name "$NAME" -p "$PORT:8333" \
  -v "$CFG:/etc/seaweedfs/s3.json:ro" \
  "$IMAGE" server -s3 -s3.config=/etc/seaweedfs/s3.json -dir=/tmp >/dev/null

export SEAWEEDFS_S3_ENDPOINT="http://localhost:$PORT"
export SEAWEEDFS_S3_ACCESS_KEY_ID="$ACCESS"
export SEAWEEDFS_S3_SECRET_ACCESS_KEY="$SECRET"
export SEAWEEDFS_VERSION="4.33"

# Wait until a SIGNED ListBuckets actually succeeds — a 403 to an unsigned probe
# only proves the port is open, not that the filer/master are wired (an early
# break makes the slice self-skip). Poll the real client instead.
echo "==> waiting for the S3 gateway to accept signed requests"
ready=""
for _ in $(seq 1 60); do
  if node --input-type=module -e '
    import { createSeaweedFSClient } from "'"$HERE"'/../../../services/provisioning-orchestrator/src/reconcilers/s3-rest-client.mjs";
    await createSeaweedFSClient({ endpoint: process.env.SEAWEEDFS_S3_ENDPOINT, accessKeyId: process.env.SEAWEEDFS_S3_ACCESS_KEY_ID, secretAccessKey: process.env.SEAWEEDFS_S3_SECRET_ACCESS_KEY }).listBuckets();
  ' >/dev/null 2>&1; then ready=1; break; fi
  sleep 1
done
[ -n "$ready" ] || echo "==> WARNING: SeaweedFS did not become ready; the slice will self-skip"

echo "==> running reconciliation slice against real SeaweedFS"
node --test "$HERE"/seaweedfs-reconcile.test.mjs
