# AGENTS.md

## Project

`sealai` — Turbo monorepo for an internal platform (Next.js UIs + Go services).
**Package manager:** bun — never npm/pnpm/yarn.

## Workspace layout

```
apps/
  ui/         Next.js — main product UI (default port 3000)
  registry/   Next.js — component preview registry (default port 10000)
  api/        Go service (Huma + chi) — K8s/db/task/logs/metrics endpoints (default port 9000)
  whodb/      backend-only Go service; see apps/whodb/AGENTS.md
packages/
  ui/         @workspace/ui — shared shadcn/ui + Radix + Tailwind 4 components
  api/        @workspace/api — shared API fetchers, hooks, schemas, and constants
  shared/     @workspace/shared — runtime utils (k8s quantity parsing + zod)
  dev-tweaks/ @workspace/dev-tweaks — dev tweaks panel (dev/demo only)
  eslint-config/, typescript-config/ — shared lint and tsconfig bases
```

## Commands (from repo root)

- `bun dev` — dev servers excluding `@sealai/whodb`; `bun dev:all` — all of them
- `bun dev:worktree` — dev servers on deterministic per-checkout ports; use it instead of `bun dev` in a linked worktree (`--print` shows the port plan without starting anything)
- `bun build` / `bun lint` / `bun format` / `bun typecheck` — turbo, per-package
- `bun check` / `bun fix` — ultracite/biome, the source of truth for code quality
- Go API: standard `go` toolchain in `apps/api`; WhoDB: root `bun whodb:*` scripts

## Conventions

- **Boundaries:** import through package exports (`@workspace/ui/*`, `@workspace/api/*`) or app-local `@/*`; never across apps or into another package's private `src`.
- **Styling:** no inline color/spacing/radius/type/shadow literals — use tokens (`packages/ui/src/styles/globals.css`) or the Tailwind scale.
- **UI reuse:** compose UI from existing `@workspace/ui` components (see `packages/ui/src/components`) before writing new ones; reach for the `app-*` wrappers (`app-button`, `app-dialog`, `app-select`, …) rather than the raw shadcn primitives they wrap.
- **Custom utility classes:** register them with `@utility` in `globals.css`, not as plain classes inside `@layer utilities` — Tailwind 4 silently emits nothing when a plain layered class is used behind a variant prefix (`hover:`, `[&_...]:`).
- **Domain:** `CONTEXT.md` names every product concept (AP, DB, deployment, public access, canvas, settings, …) and `docs/adr/` the accepted decisions behind them — before changing behavior in any area they name, read the relevant sections and ADRs; if a change would contradict an accepted ADR, stop and raise it instead of proceeding.
- **Ports:** before using a local port, confirm it serves *this* checkout (not another worktree's): `lsof -a -d cwd -Fn -p $(lsof -tiTCP:<port> -sTCP:LISTEN | head -1)` — the cwd must be inside it.

## When making changes

- Before claiming code work is done, run `bun typecheck` and `bun check`. Run focused tests for touched behavior: TS via `bun test <path>` from the package's directory (there is no `test` script), Go via `go test ./...`.
- Next.js apps set `output: "standalone"` and the Dockerfiles in `apps/ui` and `apps/registry` depend on it — keep it set, and check any `next.config.*` change against those Dockerfiles.
