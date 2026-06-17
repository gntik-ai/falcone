#!/usr/bin/env bash
# Author every platform Secret the kind-enabled Falcone components need for a
# FROM-SCRATCH install (campaign-20260617). Generates fresh random credentials and
# applies each Secret idempotently (create --dry-run | apply). Echoes only NAMES.
#
# CRITICAL INVARIANTS (derived from chart + deploy/kind, NOT docs):
#  * Keycloak gets its initial admin from in-falcone-identity-client
#    (envFromSecrets -> KC_BOOTSTRAP_ADMIN_USERNAME/PASSWORD). Those MUST equal the
#    in-falcone-keycloak-admin username/password the bootstrap Job logs in with.
#  * The control-plane reads S3 creds from in-falcone-storage keys
#    s3_access_key/s3_secret_key (deploy/kind/values-kind.yaml). SeaweedFS reads its
#    own in-falcone-seaweedfs-s3-creds keys s3AccessKey/s3SecretKey. They MUST be the
#    SAME pair or S3 auth fails. We PRE-CREATE in-falcone-seaweedfs-s3-creds with known
#    values; the chart's seaweedfs-s3-creds.yaml uses `lookup` and REUSES an existing
#    Secret, so pre-creating it pins the gateway identity to the same pair.
#  * documentdb admin user is falcone_doc_admin (POSTGRES_USER); in-falcone-ferretdb
#    postgresql-url embeds that user + the documentdb password.
#  * in-falcone-documentdb-replication carries BOTH `password` (read by the
#    documentdb-init Job) and `realtime-url` (read by control-plane REALTIME_DOCUMENTDB_URL).
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
export KUBECONFIG="${KUBECONFIG:-$REPO_ROOT/kubeconfig-test-cluster-b.yaml}"
NS="${NS:-falcone}"

need() { command -v "$1" >/dev/null 2>&1 || { echo "missing tool: $1" >&2; exit 1; }; }
need kubectl; need openssl

# --- helpers ---------------------------------------------------------------
rand()    { openssl rand -hex "${1:-24}"; }          # hex, safe in URLs/env
randb64() { openssl rand -base64 "${1:-24}" | tr -d '\n=+/'; }  # alnum-ish
apply_secret() {
  # apply_secret <name> [--type tls] <kubectl-create-args...>
  local name="$1"; shift
  kubectl create secret "$@" -n "$NS" --dry-run=client -o yaml | kubectl apply -f -
  echo "  secret/$name"
}

echo "Authoring Falcone platform secrets in namespace $NS ..."

# --- generate credential material (once) -----------------------------------
PG_APP_PW="$(rand 24)"                 # falcone app role
PG_SUPER_PW="$(rand 24)"               # postgres superuser
DOC_PW="$(rand 24)"                    # documentdb falcone_doc_admin
REPL_PW="$(rand 24)"                   # documentdb logical-replication role
KAFKA_PLACEHOLDER="$(rand 16)"         # unused by kind profile but keeps schema
KC_ADMIN_USER="admin"
KC_ADMIN_PW="$(rand 24)"
SUPERADMIN_PW="$(rand 24)"
APISIX_ADMIN_KEY="$(rand 24)"
IDENTITY_CLIENT_ID="in-falcone-gateway"
IDENTITY_CLIENT_SECRET="$(rand 24)"
S3_ACCESS_KEY="$(randb64 15)"          # shared seaweedfs <-> storage access key
S3_SECRET_KEY="$(randb64 30)"          # shared seaweedfs <-> storage secret key

PG_USER="falcone"
PG_DB="in_falcone"
DOC_USER="falcone_doc_admin"
DOC_DB="in_falcone"

# --- 1. in-falcone-postgresql (envFromSecrets on postgresql StatefulSet) ----
# bitnami/postgresql reads POSTGRESQL_USERNAME/PASSWORD (app role) +
# POSTGRESQL_POSTGRES_PASSWORD (superuser). Also consumed by control-plane,
# executor, seaweedfs filer initContainer.
apply_secret in-falcone-postgresql generic in-falcone-postgresql \
  --from-literal=POSTGRESQL_USERNAME="$PG_USER" \
  --from-literal=POSTGRESQL_PASSWORD="$PG_APP_PW" \
  --from-literal=POSTGRESQL_POSTGRES_PASSWORD="$PG_SUPER_PW"

# --- 2. in-falcone-documentdb (envFromSecrets on documentdb StatefulSet) ----
# Official postgres image reads POSTGRES_USER/PASSWORD/DB at initdb. Consumed by
# control-plane/executor MONGO_PASSWORD and the ferretdb URL below.
apply_secret in-falcone-documentdb generic in-falcone-documentdb \
  --from-literal=POSTGRES_USER="$DOC_USER" \
  --from-literal=POSTGRES_PASSWORD="$DOC_PW" \
  --from-literal=POSTGRES_DB="$DOC_DB"

# --- 3. in-falcone-ferretdb (FERRETDB_POSTGRESQL_URL secretKeyRef) ----------
# Full DSN to the documentdb engine, database `postgres` (where the documentdb
# extension lives), as the documentdb admin role. Password MUST match #2.
apply_secret in-falcone-ferretdb generic in-falcone-ferretdb \
  --from-literal=postgresql-url="postgres://${DOC_USER}:${DOC_PW}@falcone-documentdb:5432/postgres?sslmode=disable"

# --- 4. in-falcone-documentdb-replication -----------------------------------
# `password` -> documentdb-init Job (creates role falcone_cdc_repl with this pw).
# `realtime-url` -> control-plane REALTIME_DOCUMENTDB_URL (replication-privileged).
apply_secret in-falcone-documentdb-replication generic in-falcone-documentdb-replication \
  --from-literal=password="$REPL_PW" \
  --from-literal=realtime-url="postgres://falcone_cdc_repl:${REPL_PW}@falcone-documentdb:5432/postgres?sslmode=disable&replication=database"

# --- 5. in-falcone-kafka (envFromSecrets on kafka StatefulSet) --------------
# Single-broker KRaft config. These are STRUCTURAL (node id 0, localhost quorum),
# not sensitive, but the StatefulSet reads them from this Secret.
apply_secret in-falcone-kafka generic in-falcone-kafka \
  --from-literal=KAFKA_CFG_NODE_ID="0" \
  --from-literal=KAFKA_CFG_PROCESS_ROLES="controller,broker" \
  --from-literal=KAFKA_CFG_CONTROLLER_LISTENER_NAMES="CONTROLLER" \
  --from-literal=KAFKA_CFG_CONTROLLER_QUORUM_VOTERS="0@127.0.0.1:9093" \
  --from-literal=KAFKA_CFG_LISTENERS="PLAINTEXT://:9092,CONTROLLER://:9093" \
  --from-literal=KAFKA_CFG_ADVERTISED_LISTENERS="PLAINTEXT://falcone-kafka:9092" \
  --from-literal=KAFKA_CFG_LISTENER_SECURITY_PROTOCOL_MAP="CONTROLLER:PLAINTEXT,PLAINTEXT:PLAINTEXT"

# --- 6. in-falcone-storage (control-plane STORAGE_S3_* secretKeyRef) --------
# Keys s3_access_key/s3_secret_key per deploy/kind/values-kind.yaml. Value pair is
# SHARED with in-falcone-seaweedfs-s3-creds (#11) so S3 auth lines up.
apply_secret in-falcone-storage generic in-falcone-storage \
  --from-literal=s3_access_key="$S3_ACCESS_KEY" \
  --from-literal=s3_secret_key="$S3_SECRET_KEY"

# --- 7. in-falcone-keycloak-admin (bootstrap Job admin login) ---------------
apply_secret in-falcone-keycloak-admin generic in-falcone-keycloak-admin \
  --from-literal=username="$KC_ADMIN_USER" \
  --from-literal=password="$KC_ADMIN_PW"

# --- 8. in-falcone-identity-client (Keycloak envFromSecrets) ----------------
# Provides the INITIAL admin Keycloak creates at first boot. MUST equal #7 so the
# bootstrap Job can authenticate against the freshly provisioned admin.
apply_secret in-falcone-identity-client generic in-falcone-identity-client \
  --from-literal=KC_BOOTSTRAP_ADMIN_USERNAME="$KC_ADMIN_USER" \
  --from-literal=KC_BOOTSTRAP_ADMIN_PASSWORD="$KC_ADMIN_PW"

# --- 9. in-falcone-superadmin (bootstrap Job sets platform superadmin pw) ---
apply_secret in-falcone-superadmin generic in-falcone-superadmin \
  --from-literal=password="$SUPERADMIN_PW"

# --- 10. in-falcone-apisix-admin (bootstrap Job apisix admin key) -----------
# Unused under APISIX_STAND_ALONE (no admin API), but the bootstrap Job references it.
apply_secret in-falcone-apisix-admin generic in-falcone-apisix-admin \
  --from-literal=admin-key="$APISIX_ADMIN_KEY"

# --- 11. in-falcone-seaweedfs-s3-creds (PIN seaweedfs gateway identity) -----
# Pre-created so charts/in-falcone/templates/seaweedfs-s3-creds.yaml `lookup` REUSES
# it (no random rotation) and derives the identities JSON config Secret from the SAME
# pair. Keys s3AccessKey/s3SecretKey == in-falcone-storage s3_access_key/s3_secret_key.
# THIS Secret is ALSO rendered by the chart as a Helm-owned object, so it MUST carry
# Helm ownership metadata or `helm install` refuses to adopt it ("invalid ownership
# metadata ... must be set to Helm"). Stamp managed-by + release annotations so Helm
# adopts the pinned value instead of conflicting.
kubectl create secret generic in-falcone-seaweedfs-s3-creds -n "$NS" \
  --from-literal=s3AccessKey="$S3_ACCESS_KEY" \
  --from-literal=s3SecretKey="$S3_SECRET_KEY" \
  --dry-run=client -o yaml \
  | kubectl label  --local -f - app.kubernetes.io/managed-by=Helm -o yaml \
  | kubectl annotate --local -f - meta.helm.sh/release-name=falcone \
      meta.helm.sh/release-namespace="$NS" -o yaml \
  | kubectl apply -f -
echo "  secret/in-falcone-seaweedfs-s3-creds (helm-adopted)"

# --- 11b. in-falcone-gateway-shared-secret (apisix <-> executor trust) ------
# apisix.yaml injects `x-gateway-auth: ${{GATEWAY_SHARED_SECRET}}` on the 5 executor
# routes and reads the value from its PROCESS env; without it APISIX fails to load its
# standalone config ("can't find environment variable GATEWAY_SHARED_SECRET") and
# CrashLoops. values-campaign.yaml maps apisix.env GATEWAY_SHARED_SECRET to this secret.
apply_secret in-falcone-gateway-shared-secret generic in-falcone-gateway-shared-secret \
  --from-literal=secret="$(rand 24)"

# --- 12-15. publicSurface TLS secrets (REQUIRED by the rendered Ingress) -----
# The chart default platform.network.exposureKind=Ingress + publicSurface.tls.mode=
# clusterManaged (NOT overridden by values-kind.yaml) renders a single nginx Ingress
# that references all four in-falcone-dev-<surface>-tls secrets. The Ingress object
# applies even if the secrets are absent, but the live cluster carries all four and
# we recreate them (self-signed) to preserve the working TLS state after the nuke.
# These are the ONLY TLS secrets the kind profile needs (no Route/cert-manager
# publicSurface path renders; the only cert-manager Certificate is vault's, handled
# separately and degraded on kind — see install.sh).
TLS_TMP="$(mktemp -d)"; trap 'rm -rf "$TLS_TMP"' EXIT
make_tls() {
  # make_tls <secret-name> <CN/host>
  local name="$1" host="$2"
  openssl req -x509 -newkey rsa:2048 -nodes -days 825 \
    -keyout "$TLS_TMP/$name.key" -out "$TLS_TMP/$name.crt" \
    -subj "/CN=$host" -addext "subjectAltName=DNS:$host" >/dev/null 2>&1
  kubectl create secret tls "$name" -n "$NS" \
    --cert="$TLS_TMP/$name.crt" --key="$TLS_TMP/$name.key" \
    --dry-run=client -o yaml | kubectl apply -f -
  echo "  secret/$name (tls)"
}
make_tls in-falcone-dev-api-tls      api.dev.in-falcone.example.com
make_tls in-falcone-dev-console-tls  console.dev.in-falcone.example.com
make_tls in-falcone-dev-identity-tls iam.dev.in-falcone.example.com
make_tls in-falcone-dev-realtime-tls realtime.dev.in-falcone.example.com

echo ""
echo "Done. Created/updated secrets:"
echo "  Opaque: in-falcone-postgresql in-falcone-documentdb in-falcone-ferretdb"
echo "          in-falcone-documentdb-replication in-falcone-kafka in-falcone-storage"
echo "          in-falcone-keycloak-admin in-falcone-identity-client in-falcone-superadmin"
echo "          in-falcone-apisix-admin in-falcone-seaweedfs-s3-creds"
echo "  TLS:    in-falcone-dev-api-tls in-falcone-dev-console-tls"
echo "          in-falcone-dev-identity-tls in-falcone-dev-realtime-tls"
echo "(in-falcone-seaweedfs-s3-config is derived by the chart from the pinned creds)"
