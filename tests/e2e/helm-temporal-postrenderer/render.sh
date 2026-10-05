#!/usr/bin/env bash
# Helm post-renderer: defer ordinary fresh-install Temporal Jobs until their
# dependencies converge. Keep every other rendered document unchanged.
set -euo pipefail
awk -v release="${E2E_TEMPORAL_RELEASE:?}" '
  function flush() {
    bootstrap = index(name, release "-temporal-r") == 1 && name ~ /-r[0-9]+(-upgrade)?-temporal-bootstrap$/
    if (!(kind == "Job" && (name == release "-temporal-schema" || name == release "-temporal-db-bootstrap" || bootstrap))) {
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
