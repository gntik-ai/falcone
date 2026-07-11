#!/usr/bin/env bash
set -euo pipefail
set +x

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=common.sh
. "$HERE/common.sh"

REPO_ROOT="$(cd "$HERE/../../.." && pwd)"
CHART="${CHART:-$REPO_ROOT/charts/in-falcone}"
VALUES_ARGS=()
SET_ARGS=()
while [ "$#" -gt 0 ]; do
  case "$1" in
    --chart) CHART="${2:?missing --chart value}"; shift 2 ;;
    -f|--values) VALUES_ARGS+=("-f" "${2:?missing values file}"); shift 2 ;;
    --set) SET_ARGS+=("--set" "${2:?missing --set value}"); shift 2 ;;
    *) echo "usage: $0 [--chart charts/in-falcone] [-f values.yaml ...] [--set key=value ...]" >&2; exit 2 ;;
  esac
done

require_base_tools
require_helm

if helm plugin list 2>/dev/null | awk 'NR > 1 {print $1}' | grep -Fx diff >/dev/null; then
  echo "running read-only helm diff gate for release=$RELEASE namespace=$NS"
  helm diff upgrade --install "$RELEASE" "$CHART" -n "$NS" "${VALUES_ARGS[@]}" "${SET_ARGS[@]}" --detailed-exitcode
  exit $?
fi

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
echo "helm diff plugin not found; rendering manifests and running read-only kubectl diff"
helm template "$RELEASE" "$CHART" -n "$NS" "${VALUES_ARGS[@]}" "${SET_ARGS[@]}" > "$tmp/rendered.yaml"
set +e
kubectl -n "$NS" diff -f "$tmp/rendered.yaml"
status=$?
set -e
case "$status" in
  0) echo "kubectl diff: no differences"; exit 0 ;;
  1) echo "kubectl diff: differences detected"; exit 1 ;;
  *) echo "kubectl diff failed with status $status" >&2; exit "$status" ;;
esac
