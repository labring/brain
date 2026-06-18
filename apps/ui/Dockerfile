# ------------------------------------------------------------------
# 1. Base – Bun (shared WORKDIR; pruner/builder stages stay thin)
# ------------------------------------------------------------------
FROM oven/bun:1.3.5 AS base
WORKDIR /app

# ------------------------------------------------------------------
# 2. Pruner – turbo prune for @sealai/ui
# ------------------------------------------------------------------
FROM base AS pruner
COPY . .
# Must match apps/ui/package.json "name"
RUN bunx turbo@2.8.17 prune @sealai/ui --docker

# ------------------------------------------------------------------
# 3. Builder – install with Bun, build Next.js
# ------------------------------------------------------------------
FROM base AS builder

# Native deps for optional packages (e.g. some transitive builds)
RUN apt-get update && \
    apt-get install -y --no-install-recommends python3 make g++ && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

COPY --from=pruner /app/out/json/ .
# Turbo's pruned bun.lock is not compatible with Bun's lockfile parser; install from pruned package.json trees.
RUN rm -f bun.lock && bun install && bun pm cache rm

COPY --from=pruner /app/out/full/ .

# Client-inlined public env; override at build:
# docker build --build-arg NEXT_PUBLIC_APP_URL=https://your.app ...
ARG NEXT_PUBLIC_APP_URL=http://localhost:3000
ENV NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL

RUN cd apps/ui && bun run build && \
    rm -rf node_modules/.cache && \
    rm -rf .next/cache

# ------------------------------------------------------------------
# 4. Runner – Node (Next standalone; minimal runtime image)
# ------------------------------------------------------------------
FROM node:22-alpine AS runner
WORKDIR /app

RUN addgroup --system --gid 1001 nodeuser && \
    adduser --system --uid 1001 nodeuser
USER nodeuser

COPY --from=builder --chown=nodeuser:nodeuser \
    /app/apps/ui/.next/standalone ./
COPY --from=builder --chown=nodeuser:nodeuser \
    /app/apps/ui/.next/static ./apps/ui/.next/static
COPY --from=builder --chown=nodeuser:nodeuser \
    /app/apps/ui/public ./apps/ui/public

EXPOSE 3000

# Same name as builder; server code reads this at runtime (see getCallbackBaseUrl).
ARG NEXT_PUBLIC_APP_URL=http://localhost:3000
ENV NODE_ENV=production
ENV PORT=3000
ENV NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL

CMD ["node", "apps/ui/server.js"]
