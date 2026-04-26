# --- Stage 1: Install dependencies ---
FROM oven/bun:1 AS deps
WORKDIR /app
# Install build tools for native modules (better-sqlite3)
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package.json bun.lock ./
COPY apps/web_legacy/package.json ./apps/web_legacy/
RUN bun install --frozen-lockfile

# --- Stage 2: Build ---
FROM oven/bun:1 AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/web_legacy/node_modules ./apps/web_legacy/node_modules
COPY package.json bun.lock ./
COPY apps/web_legacy/ ./apps/web_legacy/
RUN bun run --cwd apps/web_legacy build

# --- Stage 3: Runtime ---
FROM oven/bun:1 AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0

# Create data directory for SQLite volume mount
RUN mkdir -p /data

# Copy standalone output (preserves monorepo directory structure)
COPY --from=builder /app/apps/web_legacy/.next/standalone ./
# Copy static assets into the app directory (Next.js expects them relative to server.js)
COPY --from=builder /app/apps/web_legacy/.next/static ./apps/web_legacy/.next/static
COPY --from=builder /app/apps/web_legacy/public ./apps/web_legacy/public

CMD ["bun", "apps/web_legacy/server.js"]
