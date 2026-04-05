# =============================================================================
# Zapp Hub — Dockerfile
# Multi-stage build: install + compile TypeScript → lean production runner
# Package manager: pnpm
# =============================================================================

# -----------------------------------------------------------------------------
# Stage 1: base
# Shared base image with pnpm available.
# -----------------------------------------------------------------------------
FROM node:20-alpine AS base

# Install pnpm via corepack (ships with Node.js 20)
RUN corepack enable && corepack prepare pnpm@latest --activate

# Install build tools required by better-sqlite3 (native addon)
RUN apk add --no-cache python3 make g++

WORKDIR /app

# -----------------------------------------------------------------------------
# Stage 2: deps
# Install ALL dependencies (including devDeps needed for tsc).
# This layer is cached independently of the source — a source-only change
# won't re-run pnpm install.
# -----------------------------------------------------------------------------
FROM base AS deps

COPY package.json pnpm-lock.yaml* ./

RUN pnpm install --frozen-lockfile

# -----------------------------------------------------------------------------
# Stage 3: builder
# Compile TypeScript → dist/
# Then prune devDependencies so we only copy production deps to the runner.
# -----------------------------------------------------------------------------
FROM deps AS builder

COPY tsconfig.json ./
COPY src/ ./src/

RUN pnpm run build

# Produce a pruned node_modules containing only production deps
RUN pnpm prune --prod

# -----------------------------------------------------------------------------
# Stage 4: runner
# Minimal production image — only compiled JS + production node_modules.
# -----------------------------------------------------------------------------
FROM node:20-alpine AS runner

LABEL maintainer="Zapp"
LABEL description="Zapp Hub — local-first smart switch backend"
LABEL version="1.0.0"

# Enable pnpm in the runner too (needed if any lifecycle scripts call pnpm)
RUN corepack enable

# Runtime-only system dependencies
# libstdc++ is required by better-sqlite3 at runtime on Alpine
RUN apk add --no-cache libstdc++ dumb-init

WORKDIR /app

# Create a non-root user for security
RUN addgroup -g 1001 -S zapp && \
    adduser  -u 1001 -S zapp -G zapp

# Create writable directories and hand them to the non-root user
RUN mkdir -p /app/data /app/firmware /app/logs && \
    chown -R zapp:zapp /app

# Copy compiled output and production node_modules from the builder stage
COPY --from=builder --chown=zapp:zapp /app/dist         ./dist
COPY --from=builder --chown=zapp:zapp /app/node_modules ./node_modules
COPY --from=builder --chown=zapp:zapp /app/package.json ./package.json

# Switch to the non-root user
USER zapp

# Expose the HTTP API port
EXPOSE 3000

# Liveness probe — uses 127.0.0.1 (not localhost) to avoid IPv6/IPv4 mismatch
# on Alpine where localhost may resolve to ::1 but the server binds 0.0.0.0.
HEALTHCHECK --interval=15s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/health || exit 1

# dumb-init as PID 1 ensures:
#   • SIGTERM is forwarded correctly to the Node.js process
#   • Zombie processes are reaped
#   • Graceful shutdown (our process.on("SIGTERM") handler) works as expected
ENTRYPOINT ["dumb-init", "--"]

CMD ["node", "dist/index.js"]
