#!/usr/bin/env bash
# Establish/refresh the port-forwards used by the live-campaign test scripts.
# The kind cluster is REMOTE (only the API server is reachable); every surface is
# reached via kubectl port-forward. Idempotent: kills stale forwards first.
# Usage:  source tests/live-campaign/lib/portforward.sh && pf_up   (and pf_down to stop)
ROOT="$(git rev-parse --show-toplevel)"
export KUBECONFIG="$ROOT/kubeconfig-test-cluster-b.yaml"
PF_PIDFILE="${TMPDIR:-/tmp}/falcone-campaign-pf.pids"

# local_port  service  remote_port
PF_MAP=(
  "9080 falcone-apisix 9080"            # gateway / REST API
  "8080 falcone-keycloak 8080"          # keycloak OIDC
  "55432 falcone-postgresql 5432"       # direct postgres
  "57017 falcone-ferretdb 27017"        # direct FerretDB (mongo wire)
  "58333 falcone-seaweedfs-s3 8333"     # direct S3
  "59090 falcone-observability 9090"    # prometheus
  "53000 falcone-grafana 3000"          # grafana
  "53001 falcone-web-console 3000"      # web console SPA
)

pf_down(){
  if [ -f "$PF_PIDFILE" ]; then while read -r p; do kill "$p" 2>/dev/null; done < "$PF_PIDFILE"; rm -f "$PF_PIDFILE"; fi
  pkill -f "port-forward.*falcone-" 2>/dev/null || true
}

pf_up(){
  pf_down; : > "$PF_PIDFILE"
  for m in "${PF_MAP[@]}"; do set -- $m
    kubectl port-forward -n falcone "svc/$2" "$1:$3" >/dev/null 2>&1 &
    echo $! >> "$PF_PIDFILE"
  done
  sleep 4
  echo "port-forwards up:"
  for m in "${PF_MAP[@]}"; do set -- $m; printf "  localhost:%s -> %s:%s\n" "$1" "$2" "$3"; done
}

# Stable local endpoints for the test scripts (override-able).
export FALCONE_GATEWAY="${FALCONE_GATEWAY:-http://localhost:9080}"
export FALCONE_KEYCLOAK="${FALCONE_KEYCLOAK:-http://localhost:8080}"
export FALCONE_REALM="${FALCONE_REALM:-in-falcone-platform}"
export FALCONE_CONSOLE_CLIENT="${FALCONE_CONSOLE_CLIENT:-in-falcone-console}"
export FALCONE_PG="${FALCONE_PG:-postgres://falcone@localhost:55432/in_falcone}"
export FALCONE_MONGO="${FALCONE_MONGO:-mongodb://localhost:57017}"
export FALCONE_S3="${FALCONE_S3:-http://localhost:58333}"
export FALCONE_PROM="${FALCONE_PROM:-http://localhost:59090}"
export FALCONE_GRAFANA="${FALCONE_GRAFANA:-http://localhost:53000}"
export FALCONE_CONSOLE="${FALCONE_CONSOLE:-http://localhost:53001}"
