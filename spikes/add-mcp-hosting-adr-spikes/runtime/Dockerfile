# EPHEMERAL SPIKE image — minimal MCP-shaped server for the runtime/scale-to-zero spike.
FROM node:22-alpine
WORKDIR /app
COPY server.mjs ./
ENV PORT=8080
EXPOSE 8080
USER 1000
CMD ["node", "server.mjs"]
