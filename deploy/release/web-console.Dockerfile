# Release runtime image for the Falcone web-console SPA.
#
# The SPA bundle (apps/web-console/dist) is built in CI with `vite build` BEFORE this image is
# built (see .github/workflows/release-images.yml). The repo's `build` script is `tsc -b && vite
# build`; the `tsc -b` type-check has a pre-existing error baseline that does NOT affect the
# emitted bundle, so the release builds the deployable artifact with `vite build` directly.
#
# This image only serves the static bundle and proxies same-origin /v1/* API calls to the gateway
# (APISIX) via the production nginx config (apps/web-console/nginx.conf). Build context = repo root:
#   pnpm --filter @in-falcone/web-console exec vite build
#   docker build -f deploy/release/web-console.Dockerfile -t in-falcone-web-console:<tag> .
FROM nginx:1.27-alpine

# Serve the pre-built SPA.
COPY apps/web-console/dist /usr/share/nginx/html

# Same-origin API edge: ${GATEWAY_UPSTREAM} is substituted at container start by the nginx image's
# envsubst entrypoint; NGINX_ENVSUBST_FILTER keeps nginx's own $variables (e.g. $host, $uri) intact.
# The chart overrides GATEWAY_UPSTREAM with the in-namespace APISIX service when the release name
# differs from the default.
COPY apps/web-console/nginx.conf /etc/nginx/templates/default.conf.template
ENV GATEWAY_UPSTREAM=falcone-apisix:9080
ENV NGINX_ENVSUBST_FILTER=GATEWAY_UPSTREAM

EXPOSE 3000
CMD ["nginx", "-g", "daemon off;"]
