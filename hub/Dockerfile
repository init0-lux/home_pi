# =============================================================================
# Zapp Hub - Dockerfile
# Multi-stage build: compile TypeScript → run compiled JS
# =============================================================================

# -----------------------------------------------------------------------------
# Stage 1: Builder
# Install ALL deps (including devDeps) and compile TypeScript
# -----------------------------------------------------------------------------
FROM node:20-alpine AS builder

WORKDIR /app

# Install build dependencies needed for native modules (better-sqlite3)
RUN apk add --no-cache python3 make g++

# Copy package files first for layer caching
COPY package.json package-lock.json* ./

# Install all dependencies (including devDependencies for tsc)
RUN npm ci

# Copy source
COPY tsconfig.json ./
COPY src/ ./src/

# Compile TypeScript → dist/
RUN npm run build

# Prune devDependencies so we only ship production deps
RUN npm prune --production

# -----------------------------------------------------------------------------
# Stage 2: Production Runner
# Minimal image with only compiled JS + production node_modules
# -----------------------------------------------------------------------------
FROM node:20-alpine AS runner

LABEL maintainer="Zapp"
LABEL description="Zapp Hub - Local-first smart switch backend"
LABEL version="1.0.0"

# Install runtime-only system deps
# better-sqlite3 needs libstdc++ at runtime on Alpine
RUN apk add --no-cache libstdc++ dumb-init

WORKDIR /app

# Create non-root user for security
RUN addgroup -g 1001 -S zapp && \
    adduser -u 1001 -S zapp -G zapp

# Create data directories with correct ownership
RUN mkdir -p /app/data /app/firmware /app/logs && \
    chown -R zapp:zapp /app

# Copy compiled output from builder
COPY --from=builder --chown=zapp:zapp /app/dist ./dist
COPY --from=builder --chown=zapp:zapp /app/node_modules ./node_modules
COPY --from=builder --chown=zapp:zapp /app/package.json ./package.json

# Switch to non-root user
USER zapp

# Expose HTTP API port
EXPOSE 3000

# Health check using the /health endpoint
HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/health || exit 1

# Use dumb-init as PID 1 to properly forward signals and reap zombie processes
# This ensures graceful shutdown (SIGTERM) is correctly handled by Node.js
ENTRYPOINT ["dumb-init", "--"]

CMD ["node", "dist/index.js"]
