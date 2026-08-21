# ------------------------------------------------------------------
# 1. Pruner – Bun + turbo prune for @sealai/registry
# ------------------------------------------------------------------
FROM oven/bun:1.3.5 AS pruner
WORKDIR /app
COPY . .
# Must match apps/registry/package.json "name"
RUN bunx turbo@2.8.17 prune @sealai/registry --docker

# ------------------------------------------------------------------
# 2. Builder – install with Bun, build Next.js
# ------------------------------------------------------------------
FROM oven/bun:1.3.5 AS builder
WORKDIR /app

RUN apt-get update && \
    apt-get install -y --no-install-recommends python3 make g++ && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

COPY --from=pruner /app/out/json/ .
# Turbo's pruned bun.lock is not compatible with Bun's lockfile parser; install from pruned package.json trees.
RUN rm -f bun.lock && bun install

COPY --from=pruner /app/out/full/ .

RUN cd apps/registry && bun run build && \
    rm -rf node_modules/.cache && \
    rm -rf .next/cache

# ------------------------------------------------------------------
# 3. Runner – Node 22 (Next standalone; smaller than full Bun image)
# ------------------------------------------------------------------
FROM node:22-alpine AS runner
WORKDIR /app

RUN addgroup --system --gid 1001 nodeuser && \
    adduser --system --uid 1001 nodeuser
USER nodeuser

COPY --from=builder --chown=nodeuser:nodeuser \
    /app/apps/registry/.next/standalone ./
COPY --from=builder --chown=nodeuser:nodeuser \
    /app/apps/registry/.next/static ./apps/registry/.next/static
COPY --from=builder --chown=nodeuser:nodeuser \
    /app/apps/registry/public ./apps/registry/public

EXPOSE 10000

ENV NODE_ENV=production
ENV PORT=10000

CMD ["node", "apps/registry/server.js"]
