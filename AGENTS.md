# AGENTS.md

## Project

`sealai` — Turbo monorepo for an internal platform (Next.js UIs + Go services).
**Package manager:** bun — never npm/pnpm/yarn.

## Workspace layout

```
apps/
  ui/         Next.js — main product UI (default port 3000)
  registry/   Next.js — component preview registry (port 10000)
  api/        Go service (Huma + chi) — K8s/db/task/logs/metrics endpoints
  whodb/      backend-only Go service; see apps/whodb/AGENTS.md
packages/
  ui/         @workspace/ui — shared shadcn/ui + Radix + Tailwind 4 components
  api/        @workspace/api — shared API fetchers, hooks, schemas, and constants
  shared/     @workspace/shared — runtime utils (k8s quantity parsing + zod)
  eslint-config/, typescript-config/ — shared lint and tsconfig bases
```

## Commands (from repo root)

- `bun dev` — dev servers excluding `@sealai/whodb`; `bun dev:all` — all of them
- `bun build` / `bun lint` / `bun format` / `bun typecheck` — turbo, per-package
- `bun check` / `bun fix` — ultracite/biome, the source of truth for code quality
- Go API: standard `go` toolchain in `apps/api`; WhoDB: root `bun whodb:*` scripts

## Conventions

- **Boundaries:** import through package exports (`@workspace/ui/*`, `@workspace/api/*`) or app-local `@/*`; never across apps or into another package's private `src`.
- **Styling:** no inline color/spacing/radius/type/shadow literals — use tokens (`packages/ui/src/styles/globals.css`) or the Tailwind scale.
- **Domain:** before changing AP, DB, public access, canvas, or settings behavior, check `CONTEXT.md` and the ADRs in `docs/adr/`; if a change would contradict an accepted ADR, stop and raise it instead of proceeding.
- **Crossplane:** compatibility with Crossplane-era behavior, fields, routes, docs, or naming is out of scope — don't preserve it unless explicitly asked.

## When making changes

- Before claiming code work is done, run `bun typecheck` and `bun check`. Run focused tests for touched behavior: TS via `bun test <path>` from the app directory (there is no `test` script), Go via `go test ./...`.
- `output: "standalone"` is set on Next.js apps — be mindful when touching build config (Docker depends on it).
