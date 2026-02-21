# --- Stage 1: Install dependencies ---
FROM oven/bun:1 AS deps
WORKDIR /app
# Install build tools for native modules (better-sqlite3)
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package.json bun.lock ./
COPY apps/web/package.json ./apps/web/
RUN bun install --frozen-lockfile

# --- Stage 2: Build ---
FROM oven/bun:1 AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/web/node_modules ./apps/web/node_modules
COPY package.json bun.lock ./
COPY apps/web/ ./apps/web/
RUN bun run --cwd apps/web build

# --- Stage 3: Runtime ---
FROM oven/bun:1 AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0

# Create data directory for SQLite volume mount
RUN mkdir -p /data

# Copy built assets and dependencies
COPY --from=builder /app/apps/web/.next/standalone ./
COPY --from=builder /app/apps/web/.next/static ./.next/static
COPY --from=builder /app/apps/web/public ./public

CMD ["bun", "server.js"]
