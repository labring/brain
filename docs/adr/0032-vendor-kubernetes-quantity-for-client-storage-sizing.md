# Vendor a Kubernetes quantity port for client-side storage sizing

AP Storage Mount sizes were hand-typed Kubernetes quantity strings (e.g. `1Gi`) validated by regex at submit time. Storage size is now entered as a bounded decimal number of `Gi` with a fixed, non-editable unit (`StorageSizeInput`) on both the Docker deploy pane and AP Settings, backed by a vendored TypeScript port of Kubernetes `resource.Quantity` in `@workspace/shared`. The port is kept byte-identical to upstream (SealOS) and excluded from lint/format so it re-syncs as a clean overwrite; it is the single client-side authority for parsing, comparing, canonicalizing, and displaying quantities.

We use the port rather than a bespoke parser because the client must agree with the Go backend, which uses `k8s.io/apimachinery/pkg/api/resource`. Real PVCs are stored canonically — a `0.1Gi` request becomes `107374182400m` — which a naive parser mishandles. Client-side range and expand-only (no-shrink) checks **deliberately duplicate** the backend's authoritative enforcement to give inline feedback before submit; the backend and Kubernetes remain the source of truth, so any divergence degrades to a slightly-off hint, never corrupted data.

## Considered Options

- **A bespoke ~30-line `Mi/Gi/Ti` parser.** Rejected: it would drift from the backend's quantity semantics and breaks on canonical forms such as `107374182400m`.
- **A `SettingsSlider`, matching CPU/Memory/DB storage.** Rejected: an AP has a _list_ of Storage Mounts, not a single value; a slider per row is too tall for the repeater and imprecise for decimal `Gi`. Storage is the one resource input that is intentionally not a slider.

## Consequences

- The vendored files are a fork that will not receive upstream fixes automatically. Mitigated by provenance and re-sync instructions in `packages/shared/src/vendor/quantities/VENDOR.md` and by the stability of the Kubernetes quantity format.
- Existing ad-hoc `Mi`↔`Gi` helpers (memory quota, DB settings, metrics formatting) can migrate onto this single implementation.
