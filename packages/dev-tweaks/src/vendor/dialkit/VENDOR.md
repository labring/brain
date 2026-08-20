# Vendored: DialKit (core + React)

These files are the core and React portions of DialKit, Josh Puckett's
real-time parameter-tweaking panel. They are the whole implementation of
`@workspace/dev-tweaks` — the package entry just re-exports this directory's
public API, and the panel UI/styling is DialKit's own (`styles/theme.css`).

- **Source repo:** github.com/joshpuckett/dialkit (MIT, `LICENSE` alongside)
- **Source path:** `src/`
- **Vendored at commit:** `9dd1c68e3850a92d8be4525fd3016e61329751b3` (v1.4.3)
- **Vendored on:** 2026-08-19

## Local modifications

- Every `.ts`/`.tsx` file carries a leading `// @ts-nocheck` line. Upstream
  compiles under its own looser tsconfig (React 18 types, no
  `noUncheckedIndexedAccess`); workspace tsconfigs would reject it, and these
  files are deliberately not held to workspace compiler options. Nothing else
  is changed.

## Dropped from upstream

- `src/solid/`, `src/svelte/`, `src/vue/` framework adapters (React-only here).
- `src/*.test.ts` (node:test suites, some spawn svelte/vue toolchains),
  `example/`, `scripts/`, tsup/svelte build configs, and stray checked-in
  `.d.ts`/`.d.ts.map` files.

## Rules

- **Do not hand-edit these files** beyond the `@ts-nocheck` header. Treat them
  as read-only; local edits turn a future re-sync into a merge.
- They are excluded from Biome (`biome.jsonc` override) and ESLint
  (`packages/dev-tweaks/eslint.config.js` ignores), and `@ts-nocheck` keeps
  `tsc` out — upstream code stays as upstream wrote it.
- To re-sync: overwrite from upstream `src/` (same subset), re-apply the
  `@ts-nocheck` headers, then update the commit and date in this file.
