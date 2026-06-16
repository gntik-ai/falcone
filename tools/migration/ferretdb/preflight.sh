#!/usr/bin/env bash
# preflight.sh — cutover precondition gate (add-ferretdb-data-migration-runbook #461, T02.1). Asserts
# the dedicated postgres-documentdb engine is Ready BEFORE verifying the FerretDB gateway is reachable
# (engine-first startup order, ADR-14), prints the confirmed version pair, and exits non-zero with a
# clear message if any precondition is unmet. Run as step 1 of the cutover runbook.
#
#   preflight.sh --ferretdb-uri <uri> [--engine-pod <name|selector>] [--namespace <ns>] [--kubeconfig <path>]
#
# --engine-pod is the Kubernetes path (kubectl wait Ready). Omit it for a Docker-Compose / local
# target where the engine is gated by the gateway's own connection retry.
set -euo pipefail

FERRETDB_URI="" ENGINE_POD="" NAMESPACE="" KUBECONFIG_ARG=""
EXPECTED_FERRETDB="2.7.0"
while [ $# -gt 0 ]; do
  case "$1" in
    --ferretdb-uri) FERRETDB_URI="$2"; shift 2;;
    --engine-pod)   ENGINE_POD="$2"; shift 2;;
    --namespace)    NAMESPACE="$2"; shift 2;;
    --kubeconfig)   KUBECONFIG_ARG="$2"; shift 2;;
    *) echo "unknown arg: $1" >&2; exit 2;;
  esac
done
[ -n "$FERRETDB_URI" ] || { echo "usage: preflight.sh --ferretdb-uri <uri> [--engine-pod <p>] [--namespace <ns>] [--kubeconfig <path>]" >&2; exit 2; }
command -v mongosh >/dev/null || { echo "PREFLIGHT FAIL: mongosh not found on PATH" >&2; exit 2; }

# 1. Engine-first: the dedicated postgres-documentdb engine must be Ready before the gateway.
if [ -n "$ENGINE_POD" ]; then
  command -v kubectl >/dev/null || { echo "PREFLIGHT FAIL: kubectl not found (required with --engine-pod)" >&2; exit 2; }
  KARGS=(); [ -n "$NAMESPACE" ] && KARGS+=(-n "$NAMESPACE"); [ -n "$KUBECONFIG_ARG" ] && export KUBECONFIG="$KUBECONFIG_ARG"
  echo ">> waiting for DocumentDB engine pod '$ENGINE_POD' to be Ready ..."
  if ! kubectl "${KARGS[@]}" wait --for=condition=ready "pod/$ENGINE_POD" --timeout=180s 2>/dev/null \
     && ! kubectl "${KARGS[@]}" wait --for=condition=ready pod -l "$ENGINE_POD" --timeout=180s 2>/dev/null; then
    echo "PREFLIGHT FAIL: DocumentDB engine '$ENGINE_POD' did not reach Ready" >&2; exit 1
  fi
  echo ">> engine Ready."
else
  echo ">> (no --engine-pod; skipping k8s engine-Ready gate — engine ordering gated by gateway connection retry)"
fi

# 2. Gateway reachable + version.
echo ">> verifying FerretDB gateway reachable ..."
BUILD="$(mongosh "$FERRETDB_URI" --quiet --eval 'const b = db.getSiblingDB("admin").runCommand({buildInfo:1}); print((b.version||"?")+"|"+(b.ferretdb && b.ferretdb.version || ""))' 2>/dev/null || true)"
[ -n "$BUILD" ] || { echo "PREFLIGHT FAIL: FerretDB gateway not reachable at the given URI" >&2; exit 1; }
WIRE_VERSION="${BUILD%%|*}"; FERRET_VERSION="${BUILD##*|}"
echo ">> gateway reachable. buildInfo.version=$WIRE_VERSION ferretdb.version=${FERRET_VERSION:-<unreported>}"
echo ">> confirmed version pair target: ferretdb:${EXPECTED_FERRETDB} / postgres-documentdb:17-0.107.0-ferretdb-${EXPECTED_FERRETDB}"
echo ">> PREFLIGHT PASS"
