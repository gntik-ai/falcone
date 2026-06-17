#!/usr/bin/env bash
# Run a command with the live-campaign test credentials in the environment.
# Reads ONLY the specific platform secrets the harness needs to authenticate and to
# make direct datastore connections (superadmin password, S3 keys, PG/DocumentDB
# passwords). Values are injected into the child process env and never written to disk.
#
#   usage:  bash tests/live-campaign/lib/creds.sh <cmd ...>
#   e.g.    bash tests/live-campaign/lib/creds.sh node tests/live-campaign/seed.mjs
set -euo pipefail
ROOT="$(git rev-parse --show-toplevel)"
export KUBECONFIG="$ROOT/kubeconfig-test-cluster-b.yaml"
NS="${NS:-falcone}"
sd() { kubectl get secret "$1" -n "$NS" -o jsonpath="{.data.$2}" 2>/dev/null | base64 -d; }

export FALCONE_SUPERADMIN_USER="${FALCONE_SUPERADMIN_USER:-superadmin}"
export FALCONE_SUPERADMIN_PW="$(sd in-falcone-superadmin password)"
export FALCONE_S3_ACCESS="$(sd in-falcone-storage s3_access_key)"
export FALCONE_S3_SECRET="$(sd in-falcone-storage s3_secret_key)"
export FALCONE_PG_PASSWORD="$(sd in-falcone-postgresql POSTGRESQL_PASSWORD)"
export FALCONE_PG_HOST=localhost FALCONE_PG_PORT=55432 FALCONE_PG_USER=falcone FALCONE_PG_DB=in_falcone
export FALCONE_DOC_PASSWORD="$(sd in-falcone-documentdb POSTGRES_PASSWORD)"
# Stable local endpoints (match lib/portforward.sh)
export FALCONE_GATEWAY="${FALCONE_GATEWAY:-http://localhost:9080}"
export FALCONE_KEYCLOAK="${FALCONE_KEYCLOAK:-http://localhost:8080}"
export FALCONE_REALM="${FALCONE_REALM:-in-falcone-platform}"
export FALCONE_CONSOLE_CLIENT="${FALCONE_CONSOLE_CLIENT:-in-falcone-console}"
export FALCONE_MONGO="${FALCONE_MONGO:-mongodb://localhost:57017}"
export FALCONE_S3="${FALCONE_S3:-http://localhost:58333}"
export FALCONE_PROM="${FALCONE_PROM:-http://localhost:59090}"

[ -n "$FALCONE_SUPERADMIN_PW" ] || { echo "ERROR: could not read superadmin password (is the platform installed?)" >&2; exit 1; }
exec "$@"
