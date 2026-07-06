# syntax=docker/dockerfile:1
# =============================================================================
# @hasna/telephony — telephony-serve (self-hosted HTTP API) image.
# ARM64 / Bun. PURE REMOTE per Amendment A1: the service reads/writes the shared
# cloud Postgres directly. No local state. API-key auth via @hasna/contracts.
# =============================================================================
FROM --platform=linux/arm64 oven/bun:1-alpine AS build
WORKDIR /app

# Install dependencies first (better layer caching).
COPY package.json bun.lock* ./
RUN bun install

# Build the CLI, MCP, serve bins + dist (also regenerates the OpenAPI SDK).
COPY . .
RUN bun run build

# ---- runtime -----------------------------------------------------------------
FROM --platform=linux/arm64 oven/bun:1-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    PORT=8080 \
    HASNA_TELEPHONY_STORAGE_MODE=cloud

# App code, deps, and the migration runner (owner-scoped migrations run as a
# one-shot task; the service itself runs as the app role).
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/src ./src
COPY --from=build /app/scripts ./scripts
COPY --from=build /app/package.json ./package.json

# Drop privileges (the bun base image ships a non-root `bun` user).
USER bun

EXPOSE 8080

# Liveness: the public /health probe.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT}/health" || exit 1

# Default command: start the HTTP service. The migration task overrides the
# command with: bun scripts/apply-cloud-migrations.mjs
CMD ["bun", "dist/server/cloud-entry.js"]
