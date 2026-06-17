FROM node:22-alpine AS builder
WORKDIR /app

COPY package.json ./
RUN corepack enable && pnpm install --no-frozen-lockfile

COPY index.html ./
COPY vite.config.ts ./
COPY tailwind.config.ts ./
COPY postcss.config.cjs ./
COPY tsconfig.json ./
COPY tsconfig.app.json ./
COPY tsconfig.node.json ./
COPY src ./src
ARG VITE_APP_VERSION=dev
ENV VITE_APP_VERSION=$VITE_APP_VERSION
RUN pnpm build

FROM nginx:1.27-alpine AS runtime
COPY --from=builder /app/dist /usr/share/nginx/html
# Rendered by the image's 20-envsubst-on-templates entrypoint (templates/*.template → conf.d/).
# GATEWAY_UPSTREAM is the same-origin /v1 API edge target (the chart can override it); only that
# var is substituted so nginx's own $variables in the conf are preserved (#505).
COPY nginx.conf /etc/nginx/templates/default.conf.template
ENV GATEWAY_UPSTREAM=falcone-apisix:9080
ENV NGINX_ENVSUBST_FILTER=GATEWAY_UPSTREAM
EXPOSE 3000
CMD ["nginx", "-g", "daemon off;"]
