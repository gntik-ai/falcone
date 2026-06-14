#!/usr/bin/env bash
# Pre-cutover SeaweedFS compatibility gate
# (change add-seaweedfs-data-migration-runbook, tasks 1.1-1.2).
#
# A thin runner over the adr-spike compatibility matrix
# (spikes/add-seaweedfs-storage-adr-spike/compatibility-matrix.md): it asserts the
# S3 behaviours Falcone depends on, parameterised by SeaweedFS endpoint + creds.
# Each assertion prints `PASS: <name>` or `FAIL: <name> observed=<x> expected=<y>`.
# The script exits non-zero if ANY assertion fails, so the cutover runbook can gate
# on it (go/no-go).
#
#   ./compat-gate.sh <endpoint> <access_key> <secret_key>
#
# Requires: aws, jq, curl.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=_s3lib.sh
. "$HERE/_s3lib.sh"
command -v curl >/dev/null 2>&1 || { echo "FATAL: curl not found" >&2; exit 2; }

ENDPOINT="${1:-${SEAWEEDFS_S3_ENDPOINT:-}}"
export AWS_ACCESS_KEY_ID="${2:-${AWS_ACCESS_KEY_ID:-}}"
export AWS_SECRET_ACCESS_KEY="${3:-${AWS_SECRET_ACCESS_KEY:-}}"
[ -n "$ENDPOINT" ] && [ -n "$AWS_ACCESS_KEY_ID" ] && [ -n "$AWS_SECRET_ACCESS_KEY" ] \
  || { echo "usage: compat-gate.sh <endpoint> <access_key> <secret_key>" >&2; exit 2; }

BUCKET="compat-gate-$$-${RANDOM}"
WORK="$(mktemp -d)"
FAILURES=0
cleanup() { s3api "$ENDPOINT" delete-object --bucket "$BUCKET" --key probe.txt >/dev/null 2>&1 || true
            s3api "$ENDPOINT" delete-object --bucket "$BUCKET" --key big.bin >/dev/null 2>&1 || true
            s3api "$ENDPOINT" delete-bucket --bucket "$BUCKET" >/dev/null 2>&1 || true
            rm -rf "$WORK"; }
trap cleanup EXIT

pass() { echo "PASS: $1"; }
fail() { echo "FAIL: $1 observed=$2 expected=$3"; FAILURES=$((FAILURES+1)); }

# 0. Setup bucket (also exercises createBucket).
s3api "$ENDPOINT" create-bucket --bucket "$BUCKET" >/dev/null 2>&1 || true

# 1. Path-style addressing: a path-style ListObjectsV2 against the new bucket succeeds.
if s3api "$ENDPOINT" list-objects-v2 --bucket "$BUCKET" >/dev/null 2>&1; then
  pass "addressing-style-path"
else
  fail "addressing-style-path" "list-objects error" "200"
fi

# 2. put/get object round-trip with content integrity.
echo "falcone-compat-probe" > "$WORK/probe.txt"
s3api "$ENDPOINT" put-object --bucket "$BUCKET" --key probe.txt --body "$WORK/probe.txt" >/dev/null 2>&1 || true
s3api "$ENDPOINT" get-object --bucket "$BUCKET" --key probe.txt "$WORK/probe.out" >/dev/null 2>&1 || true
if [ -f "$WORK/probe.out" ] && cmp -s "$WORK/probe.txt" "$WORK/probe.out"; then
  pass "object-roundtrip-integrity"
else
  fail "object-roundtrip-integrity" "body-mismatch" "identical"
fi

# 3. Presigned GET round-trip: generate a presigned URL and fetch it over plain HTTP.
URL="$(s3cli "$ENDPOINT" presign "s3://$BUCKET/probe.txt" 2>/dev/null || true)"
if [ -n "$URL" ]; then
  code="$(curl -s -o "$WORK/presigned.out" -w '%{http_code}' "$URL" || echo 000)"
  if [ "$code" = "200" ] && cmp -s "$WORK/probe.txt" "$WORK/presigned.out"; then
    pass "presigned-get-roundtrip"
  else
    fail "presigned-get-roundtrip" "http=$code" "200+matching-body"
  fi
else
  fail "presigned-get-roundtrip" "no-url" "presigned-url"
fi

# 4. Multipart upload completion: a >8MB object (multipart_threshold=8MB) round-trips.
dd if=/dev/urandom of="$WORK/big.bin" bs=1048576 count=10 status=none
s3cli "$ENDPOINT" cp "$WORK/big.bin" "s3://$BUCKET/big.bin" >/dev/null 2>&1 || true
remote_size="$(s3api "$ENDPOINT" head-object --bucket "$BUCKET" --key big.bin --query 'ContentLength' --output text 2>/dev/null || echo 0)"
if [ "$remote_size" = "10485760" ]; then
  pass "multipart-upload-completion"
else
  fail "multipart-upload-completion" "size=$remote_size" "10485760"
fi

# 5. IAM / bucket-policy semantics: SeaweedFS accepts the string Principal form
#    ("Principal":"*") and round-trips it via getBucketPolicy (adr-spike G1).
POLICY="$(jq -nc --arg b "$BUCKET" '{Version:"2012-10-17",Statement:[{Sid:"AllowOwner",Effect:"Allow",Principal:"*",Action:["s3:GetObject"],Resource:("arn:aws:s3:::"+$b+"/*")}]}')"
if s3api "$ENDPOINT" put-bucket-policy --bucket "$BUCKET" --policy "$POLICY" >/dev/null 2>&1 \
   && s3api "$ENDPOINT" get-bucket-policy --bucket "$BUCKET" >/dev/null 2>&1; then
  pass "iam-bucket-policy-roundtrip"
else
  fail "iam-bucket-policy-roundtrip" "put/get-failed" "policy-round-trips"
fi

echo "----"
if [ "$FAILURES" -eq 0 ]; then
  echo "GO: all compatibility assertions passed against $ENDPOINT"
  exit 0
fi
echo "NO-GO: $FAILURES compatibility assertion(s) failed against $ENDPOINT"
exit 1
