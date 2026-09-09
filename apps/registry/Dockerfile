# ------------------------------------------------------------------
# 1. Builder – install the frozen workspace, build Next.js
# ------------------------------------------------------------------
FROM oven/bun:1.3.5 AS builder
WORKDIR /app

RUN apt-get update && \
    apt-get install -y --no-install-recommends python3 make g++ && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# Keep the original workspace and lockfile together. Turbo's pruned lockfile
# cannot be installed frozen with this Bun version; re-resolving it would make
# the production dependency versions differ from CI.
COPY . .
RUN bun install --frozen-lockfile

RUN cd apps/registry && bun run build && \
    rm -rf node_modules/.cache && \
    rm -rf .next/cache

# ------------------------------------------------------------------
# 2. Runner – Node 22 (Next standalone; smaller than full Bun image)
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
