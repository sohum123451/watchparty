# syntax=docker/dockerfile:1.4
# ==============================================================================
# WatchParty - Production Multi-Stage Dockerfile
# Optimized for minimal footprint, layer caching, and hardened non-root runtime
# ==============================================================================

# 1. Base dependencies stage
FROM node:22-alpine AS base
WORKDIR /app
RUN apk add --no-cache libc6-compat
ENV NODE_ENV=production

# 2. Builder stage
FROM node:22-alpine AS builder
WORKDIR /app
ENV NODE_ENV=development

# Copy package manifests for monorepo workspaces
COPY package*.json ./
COPY packages/shared/package*.json ./packages/shared/
COPY packages/server/package*.json ./packages/server/
COPY packages/client/package*.json ./packages/client/

# Install all dependencies (including devDependencies for compilation)
RUN npm ci

# Copy source code and build configs
COPY tsconfig*.json ./
COPY packages/shared ./packages/shared
COPY packages/server ./packages/server
COPY packages/client ./packages/client

# Build packages in topological order
RUN npm --workspace=@watchparty/shared run build
RUN npm --workspace=@watchparty/server run build
RUN npm --workspace=@watchparty/client run build

# Prune devDependencies for lean production bundle
RUN npm prune --production

# 3. Production Runner stage
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3001

# Add non-root system group and user
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 watchparty

# Copy production node_modules and built dist directories
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages/shared/package*.json ./packages/shared/
COPY --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder /app/packages/server/package*.json ./packages/server/
COPY --from=builder /app/packages/server/dist ./packages/server/dist
COPY --from=builder /app/packages/client/package*.json ./packages/client/
COPY --from=builder /app/packages/client/dist ./packages/client/dist

# Create data volume directory and copy entrypoint script
RUN mkdir -p /data && chown -R watchparty:nodejs /data
COPY --chown=watchparty:nodejs docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# Switch to unprivileged user
USER watchparty

# Expose HTTP and WebSocket port
EXPOSE 3001

# Healthcheck probe against /health
HEALTHCHECK --interval=15s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3001/health || exit 1

# Entrypoint runs migrations before starting server
ENTRYPOINT ["docker-entrypoint.sh"]

# Launch production server
CMD ["node", "packages/server/dist/index.js"]
