# Vendored: Kubernetes `resource.Quantity` (TypeScript port)

These files are copied verbatim from the SealOS frontend monorepo. They are a
faithful TypeScript port of Kubernetes' `k8s.io/apimachinery/pkg/api/resource`
Quantity type (BigInt-based parse / compare / canonicalize / display) — matching
the semantics the Go backend (`apps/api`) relies on via `resource.ParseQuantity`.

- **Source repo:** github.com/labring/sealos
- **Source path:** `frontend/packages/shared/src/utils/quantities/`
- **Vendored at commit:** `1a9c7b16b`
- **Vendored on:** 2026-07-01

## Rules

- **Do not hand-edit these files.** Treat them as read-only. Local edits turn a
  future re-sync from a clean overwrite into a merge.
- They are excluded from Biome (`biome.jsonc` override) and ESLint
  (`packages/shared/eslint.config.js` ignores) so they stay byte-identical to
  upstream.
- To re-sync: overwrite this directory from the source path above, then update
  the commit and date in this file.

## Files

- `quantity.ts` — the `Quantity` class
- `types.ts` — `Format`, `Scale`, `BinaryScale`, `QuantityJSON`
- `errors.ts` — `QuantityParseError`
- `zod.ts` — `QuantitySchema` (zod)
- `index.ts` — barrel
