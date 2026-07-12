#!/usr/bin/env bash
set -euo pipefail
set +x

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=common.sh
. "$HERE/common.sh"

MODE="${1:---dry-run}"
case "$MODE" in
  --dry-run) STRICT=0 ;;
  --strict) STRICT=1 ;;
  *) echo "usage: $0 [--dry-run|--strict]" >&2; exit 2 ;;
esac

require_base_tools
require_bao

failures=0
printf '%-42s %-34s %-10s %s\n' "kubernetes" "openbao" "status" "sha256"
while read -r row; do
  secret="$(jq -r '.[0]' <<<"$row")"
  secret_key="$(jq -r '.[1]' <<<"$row")"
  path="$(jq -r '.[2]' <<<"$row")"
  property="$(jq -r '.[3]' <<<"$row")"
  k_hash="$(secret_fingerprint "$secret" "$secret_key")"
  if ! b_hash="$(bao_fingerprint "$path" "$property" 2>/dev/null)"; then
    printf '%-42s %-34s %-10s %s\n' "${secret}/${secret_key}" "${path}/${property}" "missing" "$k_hash"
    failures=$((failures + 1))
    continue
  fi
  if [ "$k_hash" = "$b_hash" ]; then
    printf '%-42s %-34s %-10s %s\n' "${secret}/${secret_key}" "${path}/${property}" "ok" "$k_hash"
  else
    printf '%-42s %-34s %-10s k8s=%s openbao=%s\n' "${secret}/${secret_key}" "${path}/${property}" "mismatch" "$k_hash" "$b_hash"
    failures=$((failures + 1))
  fi
done < <(platform_mappings_json | jq -cr '.[]')

if [ "$failures" -ne 0 ] && [ "$STRICT" -eq 1 ]; then
  echo "parity check failed: $failures mismatched or missing properties" >&2
  exit 1
fi
echo "parity check complete: failures=$failures"
