#!/usr/bin/env bash
set -euo pipefail

# Usage: OPERATOR_TOKEN=... ./scripts/verify-secret-storage.sh

fail() {
  echo "[FAIL] $1" >&2
  exit 1
}

echo '[1/4] Checking literal secret env vars in pod specs'
count=$(kubectl get pods -A -o json | jq '[.items[].spec.containers[]?.env[]? | select(.value != null) | select(.name | test("PASSWORD|SECRET|KEY|TOKEN"; "i"))] | length')
[[ "$count" == "0" ]] || fail "found $count literal credential env vars"

echo '[2/4] Checking OpenBao platform paths'
# OpenBao ships the `bao` CLI (the KV v2 surface is Vault-compatible). BAO_ADDR/BAO_TOKEN/BAO_CACERT
# point at the openbao Service + its CA; the legacy VAULT_* env still works as a fallback for `bao`.
bao kv list secret/platform >/tmp/falcone-secret-platform-list.txt
for required in postgresql documentdb kafka s3; do
  grep -q "$required" /tmp/falcone-secret-platform-list.txt || fail "missing OpenBao path $required"
done

echo '[3/4] Checking ExternalSecrets sync status'
unsynced=$(kubectl get externalsecret -A -o json | jq '[.items[] | select(any(.status.conditions[]?; .type == "Ready" and .status != "True"))] | length')
[[ "$unsynced" == "0" ]] || fail "found $unsynced ExternalSecrets not ready"

echo '[4/4] Checking inventory API payload hygiene'
resp=$(curl -fsS -H "Authorization: Bearer ${OPERATOR_TOKEN:?OPERATOR_TOKEN is required}" https://api.falcone.io/v1/secrets/inventory?domain=platform)
echo "$resp" | jq -e 'all(.secrets[]?; has("value") | not)' >/dev/null || fail 'inventory response exposed value field'

echo '[OK] Secret storage verification passed'
