# apps/registry — component preview registry

- Items live in `registry/<style>/<group>/<name>`; every item must also be registered in `registry/preview-registry.ts` — creating the files alone is not enough.
- After adding or changing items, run `bun run registry:build` from this directory (builds `public/r`, formats it, runs `registry:test`).
- Dev server: `bun dev` (port 10000).
