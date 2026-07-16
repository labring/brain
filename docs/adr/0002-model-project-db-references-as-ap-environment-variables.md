# Model Project DB References as AP Environment Variables

## Status

Accepted; partially revised by ADR-0018 and ADR-0052.

ADR-0018 revises the AP Environment editor source model, AP Environment Reference syntax, and compiled runtime environment behavior. The Database Binding boundary remains: Project DB references still live inside AP environment configuration rather than a separate binding record.

ADR-0052 revises the connection evidence below: literal env values are matched against the DB's address (scheme, host, port) rather than by equality with the complete DSN, because default DB read responses carry a credential-free DB Connection Template.

Project DB references are authored through the AP Environment editor and persisted as standard AP `spec.input.env` entries. This keeps Database Binding inside AP desired state, avoids a second binding persistence model, and lets the same editor handle ordinary external database credentials and Project DB references.

## Considered Options

- Add a separate Database bindings panel or binding record: rejected because it creates a second source of truth beside AP environment variables.
- Generate alias-scoped groups of variables or hidden helper env to assemble DSNs: rejected because it pollutes the environment list and makes the user-visible model harder to reason about.
- Persist reference metadata in AP spec or App Postgres: rejected because standard Kubernetes env shape is enough for AP runtime, and references can be reconstructed from exact Secret or DSN evidence when possible.
- Model external databases as first-class Database Bindings: rejected for v1 because external credentials are just user-authored environment values, not Project resources.

## Consequences

Environment variable names are the user's final API and must be unique within the AP. Canvas AP-DB connections continue to derive from exact env evidence — `valueFrom.secretKeyRef` entries that point at DB credential Secrets, or values equal to the DB's current DSN — and environment editing does not introduce a separate connection model.

The editor and persistence model is defined by ADR-0018: a `.env`-style AP Environment Raw Source with AP Environment References such as `${{postgres.DATABASE_URL}}`, compiled on update into runtime env entries backed by DB credential Secret refs. The editor-only value tokens and visible DB-backed helper variable rows this ADR originally described are superseded by that model.
