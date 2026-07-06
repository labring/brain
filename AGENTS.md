# AGENTS.md

Guidance for AI coding agents working in this repo. Keep it short.

## Project

`sealai` — Turbo monorepo for an internal platform (Next.js UIs + Go services).
**Package manager: bun 1.3.5** (NOT npm/pnpm/yarn), Node ≥20.

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
- Registry build: `cd apps/registry && bun run registry:build`
- Go API: standard `go` toolchain in `apps/api`; WhoDB: root `bun whodb:*` scripts

## Conventions

- **Boundaries:** import through package exports (`@workspace/ui/*`, `@workspace/api/*`) or app-local `@/*`; never across apps or into another package's private `src`.
- **UI components:** reuse `packages/ui/src/components/` first; app-specific compositions stay local until a second consumer needs them.
- **Styling:** Tailwind v4 tokens live in `packages/ui/src/styles/globals.css` — no inline color/spacing/radius/type/shadow literals; use tokens or the Tailwind scale.
- **Registry:** items live in `apps/registry/registry/<style>/<group>/<name>` with metadata in `preview-registry.ts`.
- **Domain:** before changing AP, DB, public access, canvas, or settings behavior, check `CONTEXT.md` and the ADRs in `docs/adr/`.
- **Crossplane:** compatibility with Crossplane-era behavior, fields, routes, docs, or naming is out of scope — don't preserve it unless explicitly asked.

## When making changes

- Default to editing existing files; don't introduce parallel patterns.
- Before claiming code work is done, run `bun typecheck` and `bun check`; run focused TS/Go tests for touched behavior when available.
- `output: "standalone"` is set on Next.js apps — be mindful when touching build config (Docker depends on it).
