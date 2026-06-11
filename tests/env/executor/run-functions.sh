#!/usr/bin/env bash
# Runner for the functions executor proof (change add-functions-execute).
# Pure node (local worker_threads backend) — no external service needed.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
echo "==> running functions executor test"
node --test "$HERE/functions-executor.test.mjs"
