#!/usr/bin/env bash
set -euo pipefail
set +x

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=common.sh
. "$HERE/common.sh"

MODE="--dry-run"
BACKUP=""
ALLOW_OVERWRITE=0
while [ "$#" -gt 0 ]; do
  case "$1" in
    --dry-run|--apply) MODE="$1"; shift ;;
    --backup) BACKUP="${2:?missing --backup value}"; shift 2 ;;
    --allow-overwrite) ALLOW_OVERWRITE=1; shift ;;
    *) echo "usage: $0 [--dry-run|--apply] [--backup /secure/path/backup.tgz] [--allow-overwrite]" >&2; exit 2 ;;
  esac
done
case "$MODE" in
  --dry-run) APPLY=0 ;;
  --apply) APPLY=1 ;;
esac
if [ "$APPLY" -eq 1 ] && [ -z "$BACKUP" ]; then
  echo "--apply requires --backup /secure/path/backup.tgz from backup-kv.sh" >&2
  exit 2
fi
if [ "$ALLOW_OVERWRITE" -eq 1 ] && [ "${CONFIRM_SECRET_OVERWRITE:-}" != "overwrite-existing-openbao-values" ]; then
  echo "--allow-overwrite also requires CONFIRM_SECRET_OVERWRITE=overwrite-existing-openbao-values" >&2
  exit 2
fi

require_base_tools
require_bao

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

if [ -n "$BACKUP" ]; then
  extract_verified_backup "$BACKUP" "$tmp/backup"
fi

assert_backup_covers_current_mappings() {
  local checksums="$tmp/backup/kubernetes/secret-checksums.tsv"
  local missing=0
  while read -r row; do
    local secret secret_key len hash expected
    secret="$(jq -r '.[0]' <<<"$row")"
    secret_key="$(jq -r '.[1]' <<<"$row")"
    len="$(secret_length "$secret" "$secret_key")"
    hash="$(secret_fingerprint "$secret" "$secret_key")"
    expected="$(printf '%s\t%s\t%s\t%s\t%s' "$NS" "$secret" "$secret_key" "$len" "$hash")"
    if ! grep -Fx "$expected" "$checksums" >/dev/null; then
      printf 'backup mismatch for %s/%s: live fingerprint is not in verified backup\n' "$secret" "$secret_key" >&2
      missing=$((missing + 1))
    fi
  done < <(platform_mappings_json | jq -cr '.[]' | sort -u)
  [ "$missing" -eq 0 ] || return 1
}

merge_source_backup_into_target() {
  local source_dir="$tmp/backup/source-kv"
  [ -d "$source_dir" ] || return 0
  echo "merging backed-up external source KV paths before mapped Kubernetes Secret overlay"
  merge_kv_tree_into_target "$source_dir" "$tmp"
}

desired_file_for() {
  local path="$1" property="$2"
  printf '%s/%s/%s' "$tmp/desired" "$path" "$property"
}

build_desired_files() {
  platform_mappings_json | jq -r '.[][2]' | sort -u | while read -r path; do
    mkdir -p "$tmp/desired/$path"
    platform_mappings_json | jq -cr --arg path "$path" '.[] | select(.[2] == $path)' | while read -r row; do
      local secret secret_key property file
      secret="$(jq -r '.[0]' <<<"$row")"
      secret_key="$(jq -r '.[1]' <<<"$row")"
      property="$(jq -r '.[3]' <<<"$row")"
      file="$(desired_file_for "$path" "$property")"
      secret_value "$secret" "$secret_key" > "$file"
      chmod 0400 "$file"
    done
  done
}

build_desired_files

echo "namespace=$NS openbao_namespace=$OPENBAO_NAMESPACE kv_mount=$KV_MOUNT mode=$MODE"
mismatches=0
missing=0
matches=0
printf '%-42s %-34s %-12s %s\n' "kubernetes" "openbao" "status" "sha256"
platform_mappings_json | jq -cr '.[]' | while read -r row; do
  secret="$(jq -r '.[0]' <<<"$row")"
  secret_key="$(jq -r '.[1]' <<<"$row")"
  path="$(jq -r '.[2]' <<<"$row")"
  property="$(jq -r '.[3]' <<<"$row")"
  desired_file="$(desired_file_for "$path" "$property")"
  k_hash="$(fingerprint < "$desired_file")"
  if ! b_hash="$(bao_fingerprint "$path" "$property" 2>/dev/null)"; then
    status=missing
    missing=$((missing + 1))
  elif [ "$k_hash" = "$b_hash" ]; then
    status=match
    matches=$((matches + 1))
  else
    status=mismatch
    mismatches=$((mismatches + 1))
  fi
  printf '%-42s %-34s %-12s %s\n' "${secret}/${secret_key}" "${path}/${property}" "$status" "$k_hash"
done > "$tmp/diff.tsv"
cat "$tmp/diff.tsv"
mismatches="$(awk '$3 == "mismatch" { n++ } END { print n + 0 }' "$tmp/diff.tsv")"
missing="$(awk '$3 == "missing" { n++ } END { print n + 0 }' "$tmp/diff.tsv")"
matches="$(awk '$3 == "match" { n++ } END { print n + 0 }' "$tmp/diff.tsv")"
echo "diff summary: match=$matches missing=$missing mismatch=$mismatches"

if [ "$APPLY" -ne 1 ]; then
  echo "dry-run only: no OpenBao writes performed"
  exit 0
fi

require_test_cluster_write_guard
assert_backup_covers_current_mappings
if [ "$ALLOW_OVERWRITE" -eq 1 ]; then
  require_backup_captured_target_kv_for_overwrite "$tmp/backup"
fi
if [ "$mismatches" -ne 0 ] && [ "$ALLOW_OVERWRITE" -ne 1 ]; then
  echo "refusing to overwrite $mismatches existing OpenBao value(s); rerun with --allow-overwrite and CONFIRM_SECRET_OVERWRITE=overwrite-existing-openbao-values after reviewing the verified backup" >&2
  exit 1
fi

merge_source_backup_into_target

platform_mappings_json | jq -r '.[][2]' | sort -u | while read -r path; do
  pairs=()
  while read -r row; do
    property="$(jq -r '.[3]' <<<"$row")"
    file="$(desired_file_for "$path" "$property")"
    pairs+=("$property" "$file")
  done < <(platform_mappings_json | jq -cr --arg path "$path" '.[] | select(.[2] == $path)')
  write_grouped_kv "$path" "$tmp" "${pairs[@]}"
  echo "wrote $KV_MOUNT/$path ($((${#pairs[@]} / 2)) properties)"
done

echo "OpenBao platform credential migration complete"
