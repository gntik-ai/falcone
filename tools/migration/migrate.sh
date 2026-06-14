#!/usr/bin/env bash
# MinIO -> SeaweedFS object migration
# (change add-seaweedfs-data-migration-runbook, tasks 2.1-2.4, 3.2-3.3).
#
# One script, two passes (same interface): `--mode initial` (bulk, MinIO live) and
# `--mode delta` (final convergence, write-freeze in effect). Per-bucket, scoped by
# `--buckets`, idempotent and safe to re-run. A pre-sync snapshot of the SOURCE is
# always written before any transfer; a post-sync snapshot of the DESTINATION is
# written after a `delta` pass.
#
# Copy tool (auto-detected, logged): rclone (preferred — S3->S3, checksum/ETag
# aware) -> mc mirror (fallback, client-side) -> aws s3 sync (fallback, client-side
# 2-hop via a local staging dir). See design D1.
#
# Buckets are NOT created here (that is add-seaweedfs-bucket-lifecycle-migration);
# the target buckets must already exist on SeaweedFS.
#
#   SRC_ACCESS_KEY=.. SRC_SECRET_KEY=.. DEST_ACCESS_KEY=.. DEST_SECRET_KEY=.. \
#     ./migrate.sh --mode initial --source-endpoint http://minio:9000 \
#                  --dest-endpoint http://seaweedfs:8333 --buckets all
#
# Requires: aws, jq; plus rclone OR mc OR aws (for the transfer itself).
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=_s3lib.sh
. "$HERE/_s3lib.sh"

MODE="" SRC_EP="" DEST_EP="" BUCKETS="all"
SNAP_DIR="${SNAPSHOT_DIR:-./migration-snapshots}"
while [ $# -gt 0 ]; do
  case "$1" in
    --mode) MODE="$2"; shift 2;;
    --source-endpoint) SRC_EP="$2"; shift 2;;
    --dest-endpoint) DEST_EP="$2"; shift 2;;
    --buckets) BUCKETS="$2"; shift 2;;
    --snapshot-dir) SNAP_DIR="$2"; shift 2;;
    *) echo "unknown arg: $1" >&2; exit 2;;
  esac
done
case "$MODE" in initial|delta) ;; *) echo "FATAL: --mode must be initial|delta" >&2; exit 2;; esac
[ -n "$SRC_EP" ] && [ -n "$DEST_EP" ] || { echo "FATAL: --source-endpoint and --dest-endpoint required" >&2; exit 2; }
: "${SRC_ACCESS_KEY:?set SRC_ACCESS_KEY}"; : "${SRC_SECRET_KEY:?set SRC_SECRET_KEY}"
: "${DEST_ACCESS_KEY:?set DEST_ACCESS_KEY}"; : "${DEST_SECRET_KEY:?set DEST_SECRET_KEY}"

TS="$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$SNAP_DIR"

# Detect the transfer tool (preference order; logged per task 2.2).
TOOL=""
if command -v rclone >/dev/null 2>&1; then TOOL="rclone"
elif command -v mc >/dev/null 2>&1; then TOOL="mc"
elif command -v aws >/dev/null 2>&1; then TOOL="aws"
else echo "FATAL: need one of rclone, mc, or aws to transfer" >&2; exit 2; fi
echo "==> migrate mode=$MODE tool=$TOOL buckets=$BUCKETS"

# --- per-tool, per-bucket sync; echoes the number of objects transferred --------
rclone_remote() { # <endpoint> <ak> <sk>
  echo ":s3,provider=Other,env_auth=false,access_key_id=$2,secret_access_key=$3,endpoint=$1,force_path_style=true,region=${AWS_REGION:-us-east-1}:"
}
sync_bucket() { # <bucket> ; prints transferred-count on the LAST line
  local b="$1" log; log="$(mktemp)"
  case "$TOOL" in
    rclone)
      rclone sync "$(rclone_remote "$SRC_EP" "$SRC_ACCESS_KEY" "$SRC_SECRET_KEY")$b" \
                  "$(rclone_remote "$DEST_EP" "$DEST_ACCESS_KEY" "$DEST_SECRET_KEY")$b" \
                  --checksum --stats-log-level NOTICE --stats 1s -v >"$log" 2>&1 || { cat "$log" >&2; rm -f "$log"; return 1; }
      grep -Eo 'Transferred:[[:space:]]+[0-9]+' "$log" | tail -1 | grep -Eo '[0-9]+' || echo 0
      ;;
    mc)
      mc alias set _src "$SRC_EP" "$SRC_ACCESS_KEY" "$SRC_SECRET_KEY" >/dev/null 2>&1
      mc alias set _dst "$DEST_EP" "$DEST_ACCESS_KEY" "$DEST_SECRET_KEY" >/dev/null 2>&1
      mc mirror --overwrite "_src/$b" "_dst/$b" >"$log" 2>&1 || { cat "$log" >&2; rm -f "$log"; return 1; }
      grep -c '^\.\.\.' "$log" 2>/dev/null || echo 0
      ;;
    aws)
      # client-side 2-hop via a staging dir (no cross-endpoint server copy in aws CLI).
      local stage; stage="$(mktemp -d)"
      AWS_ACCESS_KEY_ID="$SRC_ACCESS_KEY" AWS_SECRET_ACCESS_KEY="$SRC_SECRET_KEY" \
        s3cli "$SRC_EP" sync "s3://$b" "$stage" --no-progress >>"$log" 2>&1 || { cat "$log" >&2; rm -rf "$stage"; rm -f "$log"; return 1; }
      AWS_ACCESS_KEY_ID="$DEST_ACCESS_KEY" AWS_SECRET_ACCESS_KEY="$DEST_SECRET_KEY" \
        s3cli "$DEST_EP" sync "$stage" "s3://$b" --no-progress >>"$log" 2>&1 || { cat "$log" >&2; rm -rf "$stage"; rm -f "$log"; return 1; }
      rm -rf "$stage"
      grep -c '^upload:' "$log" 2>/dev/null || echo 0
      ;;
  esac
  rm -f "$log"
}

# 1. Pre-sync snapshot of the SOURCE before any transfer (task 3.2).
PRE="$SNAP_DIR/pre-$TS.json"
AWS_ACCESS_KEY_ID="$SRC_ACCESS_KEY" AWS_SECRET_ACCESS_KEY="$SRC_SECRET_KEY" \
  "$HERE/snapshot.sh" --endpoint "$SRC_EP" --buckets "$BUCKETS" --output-file "$PRE"
echo "==> pre-sync snapshot: $PRE"

# 2. Per-bucket transfer (omitted buckets are never touched on the destination).
TOTAL=0
while IFS= read -r b; do
  [ -n "$b" ] || continue
  echo "==> sync bucket: $b"
  n="$(sync_bucket "$b" | tail -1)"; n="${n:-0}"
  echo "    transferred objects: $n"
  TOTAL=$((TOTAL + n))
done < <(AWS_ACCESS_KEY_ID="$SRC_ACCESS_KEY" AWS_SECRET_ACCESS_KEY="$SRC_SECRET_KEY" resolve_buckets "$SRC_EP" "$BUCKETS")
echo "==> total objects transferred this pass: $TOTAL"

# 3. Post-sync snapshot of the DESTINATION after the final delta (task 3.3).
if [ "$MODE" = "delta" ]; then
  POST="$SNAP_DIR/post-$TS.json"
  AWS_ACCESS_KEY_ID="$DEST_ACCESS_KEY" AWS_SECRET_ACCESS_KEY="$DEST_SECRET_KEY" \
    "$HERE/snapshot.sh" --endpoint "$DEST_EP" --buckets "$BUCKETS" --output-file "$POST"
  echo "==> post-sync snapshot: $POST"
fi

echo "==> migrate done (mode=$MODE, tool=$TOOL, transferred=$TOTAL)"
# Re-run-idempotency signal for callers/CI: 0 transfers on a converged re-run.
echo "TRANSFERRED=$TOTAL"
