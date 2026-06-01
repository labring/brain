# Remove Public Project Preview Sharing

Public Project Preview let a project owner create a share-token link that opened a read-only project canvas without a normal workspace session. The feature is unused, but it spreads a second authorization path through the Next.js preview route, project-canvas layout API, shared API hooks, Go API routes, and Kubernetes/metrics reads.

We remove the public sharing capability rather than keeping a dormant UI entry point. Existing `/preview/project/...` links now fall through to 404. The project does not clean up existing share Secrets or Project public flags automatically because those records no longer grant access once the share-token code path is gone.

The product keeps `Project.spec.public` / `crossplane.io/project-public` as dormant Project model fields to avoid Crossplane schema and existing-resource migration. The UI also keeps the `readOnly` concept because future internal read-only surfaces can reuse it without reintroducing public share-token access.

## Considered Options

- **Delete only the preview page.** Rejected because the risky part was the share-token authorization path, not only the visible route.
- **Remove `Project.spec.public` from the CRD model.** Rejected for now because it would force a Crossplane schema/resource migration for no immediate product benefit.
- **Clean existing share Secrets and public flags.** Rejected because access is already disabled by deleting the serving path, and cleanup can be handled later if storage hygiene matters.

## Consequences

- Public share-token APIs and `X-Share-Token` clients are gone from active code.
- Historical ADR references to Public Project Preview should be read as superseded by this decision.
- Reintroducing public sharing later should be treated as a new feature: define the access model first, then rebuild the route, token service, and read-only API paths intentionally.
