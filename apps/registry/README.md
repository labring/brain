# SealAI Component Registry

This app previews and publishes reusable SealAI UI components.

## Previews

Add previews under `registry/linear/components/*` and register them in
`registry/preview-registry.ts`.

## Publishing

Build static registry payloads into `public/r`:

```bash
bun run registry:build
```
