# AGENTS.md

Guidance for AI coding agents working in this repo. Keep it short.

## Project

- **Name:** `sealai` — monorepo for an internal platform combining a Next.js UI, a shadcn-style component registry, shared TS packages, and Go backend services.
- **Shape:** Turbo monorepo with `apps/*` (ui, registry, api, whodb) and `packages/*` (ui, api, crossplane, eslint-config, typescript-config).
- **Package manager:** **bun 1.3.5** (NOT npm/pnpm/yarn). Node ≥20. Lockfile: `bun.lock`.

## Workspace layout

```
apps/
  ui/         Next.js + React — main product UI (default port 3000)
  registry/   Next.js + React — component preview registry (port 10000)
  api/        Go service (Huma + chi) — K8s/db/task/logs/metrics endpoints
  whodb/      backend-only Go service; see apps/whodb/AGENTS.md
packages/
  ui/         @workspace/ui — shared shadcn/ui + Radix + Tailwind 4 components
  api/        @workspace/api — shared API fetchers, hooks, schemas, and constants
  crossplane/ @workspace/crossplane — K8s status schemas & utilities
  eslint-config/     shared eslint configs (base, next-js, react-internal)
  typescript-config/ shared tsconfig bases
```

## Standard commands (run from repo root unless noted)

- `bun dev` — Turbo runs the usual dev servers, excluding `@sealai/whodb`
- `bun dev:all` — runs all workspace dev servers, including `@sealai/whodb`
- `bun build` — build all workspaces
- `bun lint` — turbo lint (per-package eslint)
- `bun format` — turbo format (prettier)
- `bun typecheck` — turbo typecheck (tsc --noEmit)
- `bun check` / `bun fix` — ultracite/biome code checks & autofix
- Registry build: `cd apps/registry && bun run registry:build` (runs `shadcn build`)
- Go API: `cd apps/api && <go run|go build|go test>` (see app's package.json scripts)
- WhoDB: use root `bun whodb:*` scripts or follow `apps/whodb/AGENTS.md`

## Conventions

- **Boundaries:** import through package exports (`@workspace/ui/*`, `@workspace/api/*`, `@workspace/crossplane/*`) or app-local `@/*`; never across apps or into another package's private `src`.
- **UI components:** reuse `packages/ui/src/components/` first.
- **Styling:** Tailwind v4 theme tokens live in `packages/ui/src/styles/globals.css`. Avoid inline color/spacing/radius/type/shadow literals; use tokens or Tailwind scale.
- **Quality:** Biome/ultracite is source of truth (`bun check` / `bun fix`).
- **Registry:** items live in `apps/registry/registry/<style>/<group>/<name>` with metadata in `preview-registry.ts`.
- **Domain:** before AP, DB, EntryPoint, canvas, or settings behavior changes, check `CONTEXT.md` and relevant ADRs in `docs/adr/`.

## When making changes

- Default to editing existing files; don't introduce parallel patterns.
- Before claiming code work is done, run `bun typecheck` and `bun check`; also run focused TS/Go tests for touched behavior when available.
- `output: "standalone"` is set on Next.js apps — be mindful when touching build config (Docker depends on it).
