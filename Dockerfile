# ─── Stage 1: Build / dependency install ────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

# Copy only package files first for better layer caching
COPY app/package*.json ./

# Install ALL dependencies (including devDeps for tests)
RUN npm ci --frozen-lockfile

# Copy application source
COPY app/ .

# ─── Stage 2: Production image ───────────────────────────────────────────────
FROM node:20-alpine AS production

# Install dumb-init for proper PID 1 signal handling
RUN apk add --no-cache dumb-init

WORKDIR /app

# Copy only production deps from builder
COPY app/package*.json ./
RUN npm ci --frozen-lockfile --omit=dev && npm cache clean --force

# Copy built application source
COPY --from=builder /app/index.js ./

# Create non-root user and group
RUN addgroup --system --gid 1001 nodejs \
    && adduser --system --uid 1001 --ingroup nodejs appuser \
    && chown -R appuser:nodejs /app

# Switch to non-root user
USER appuser

EXPOSE 3000

# Health check for Docker / container orchestrators
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3000/health || exit 1

# Use dumb-init as entrypoint to handle signals correctly
ENTRYPOINT ["/usr/bin/dumb-init", "--"]
CMD ["node", "index.js"]
