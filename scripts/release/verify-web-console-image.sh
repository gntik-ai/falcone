#!/usr/bin/env bash
# Verifies the contract of a built in-falcone-web-console image (switch release: next console at /).
#
# Inputs (environment): IMAGE_REF (image tag or digest reference), VERSION (release tag, e.g. 1.2.3 or dev),
# COMMIT_SHA (source commit baked into the bundle). PULL_POLICY=never checks a locally built image.
#
# Checks: the image runs as UID 1000; /app holds only the static server and one dist; no .npmrc and no registry
# token anywhere in /app; the served HTML carries the release version, not dev, and the bundle carries the source
# commit; a container started with a read-only root filesystem answers /healthz and serves the same version at /.
set -euo pipefail

: "${IMAGE_REF:?IMAGE_REF is required}"
: "${VERSION:?VERSION is required}"
: "${COMMIT_SHA:?COMMIT_SHA is required}"
PULL_POLICY="${PULL_POLICY:-always}"

work="$(mktemp -d)"
container=""
runner=""
cleanup() {
  if [ -n "$runner" ]; then docker rm -f "$runner" >/dev/null 2>&1 || true; fi
  if [ -n "$container" ]; then docker rm "$container" >/dev/null 2>&1 || true; fi
  rm -rf "$work"
}
trap cleanup EXIT
fail() { echo "::error::$*"; exit 1; }

expected_meta="<meta name=\"version\" content=\"${VERSION}\" />"
meta_of() { grep -oE '<meta name="version" content="[^"]*" />' "$1" || true; }

container="$(docker create --pull="$PULL_POLICY" "$IMAGE_REF")" || fail "could not create the web-console container"

user="$(docker inspect --format '{{.Config.User}}' "$container")"
[ "$user" = "1000" ] || fail "the image must run as UID 1000, it runs as '${user}'"

listing="$(docker export "$container" | tar -t)"
app_entries="$(printf '%s\n' "$listing" | sed -n 's#^app/\([^/][^/]*\)/\{0,1\}$#\1#p' | sort -u | paste -sd' ' -)"
[ "$app_entries" = "dist static-server.mjs" ] || fail "/app must hold only dist and static-server.mjs, it holds: ${app_entries}"
if printf '%s\n' "$listing" | grep -qE '^(app|root|home)/.*\.npmrc$'; then fail "the image contains an .npmrc"; fi

docker cp "$container:/app" "$work/app" >/dev/null || fail "could not read /app from the image"
if grep -rEl '_authToken|npm\.pkg\.github\.com|ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}' "$work/app" >/dev/null 2>&1; then
  fail "the image contains a registry token or registry credentials"
fi
[ "$(meta_of "$work/app/dist/index.html")" = "$expected_meta" ] || fail "the image HTML does not carry the release version ${VERSION}"
grep -rqF "\"${COMMIT_SHA}\"" "$work/app/dist/assets" || fail "the image bundle does not carry the source commit ${COMMIT_SHA}"

# A read-only root filesystem, as the restricted security profile runs it. The server must start and serve.
runner="$(docker run -d --read-only -p 127.0.0.1::3000 "$IMAGE_REF")" || fail "the image does not start on a read-only root filesystem"
port="$(docker port "$runner" 3000/tcp | head -n1 | sed 's/.*://')"
ready=""
for _ in $(seq 1 30); do
  if [ "$(curl -s "http://127.0.0.1:${port}/healthz" || true)" = "ok" ]; then ready=1; break; fi
  sleep 1
done
[ -n "$ready" ] || fail "/healthz did not answer ok on a read-only root filesystem"
curl -fsS "http://127.0.0.1:${port}/" -o "$work/served.html" || fail "GET / failed"
[ "$(meta_of "$work/served.html")" = "$expected_meta" ] || fail "the served HTML does not show the release version ${VERSION}"

echo "web-console image contract verified: UID 1000, next dist only, no token, read-only root, version ${VERSION}, source ${COMMIT_SHA}"
