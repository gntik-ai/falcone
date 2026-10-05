#!/usr/bin/env bash
# Helm post-renderer: defer the two ordinary fresh-install Temporal Jobs until
# OpenBao/ESO reconciliation. Keep every other rendered document unchanged.
set -euo pipefail
awk -v release="${E2E_TEMPORAL_RELEASE:?}" '
  function flush() {
    if (!(kind == "Job" && (name == release "-temporal-schema" || name == release "-temporal-db-bootstrap"))) {
      printf "%s", document
    }
    document = ""; kind = ""; name = ""; metadata = 0
  }
  /^---[[:space:]]*$/ { flush() }
  { document = document $0 "\n" }
  /^kind:[[:space:]]*/ { kind = $2 }
  /^metadata:[[:space:]]*$/ { metadata = 1; next }
  metadata && /^[^[:space:]#]/ { metadata = 0 }
  metadata && /^  name:[[:space:]]*/ { name = $2; gsub(/["\047]/, "", name) }
  END { flush() }
'
