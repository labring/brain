# Model Project DB References as AP Environment Variables

Partially revised by ADR-0018 for the AP Environment editor source model, Reference syntax, and compiled runtime environment behavior. The Database Binding boundary remains: Project DB references still live inside AP environment configuration rather than a separate binding record.

Project DB references are authored through the AP Environment editor and persisted as standard AP `spec.input.env` entries. This keeps Database Binding inside AP desired state, avoids a second binding persistence model, and lets the same editor handle ordinary external database credentials and Project DB references.

## Considered Options

- Add a separate Database bindings panel or binding record: rejected because it creates a second source of truth beside AP environment variables.
- Generate alias-scoped groups of variables or hidden helper env to assemble DSNs: rejected because it pollutes the environment list and makes the user-visible model harder to reason about.
- Persist reference metadata in AP spec or App Postgres: rejected because standard Kubernetes env shape is enough for AP runtime, and references can be reconstructed from exact Secret or DSN evidence when possible.
- Model external databases as first-class Database Bindings: rejected for v1 because external credentials are just user-authored environment values, not Project resources.

## Consequences

The Environment editor must be structured enough to represent direct values and Project DB references. DSN references write selected private or public connection strings as ordinary env values; primitive fields write `valueFrom.secretKeyRef`. Environment variable names are the user's final API and must be unique within the AP.

The editor may offer editor-only value tokens, such as `${{PGPASSWORD}}`, to help users compose environment values from other environment variables. These tokens are not a new AP runtime template language and are not persisted verbatim. Before saving, the editor resolves them into standard AP environment entries: composed values use Kubernetes env expansion syntax such as `$(PGPASSWORD)`, and any DB-backed helper variables required by those tokens are materialized as normal AP env rows.

Token-driven helper variables remain part of the AP environment list because they are real runtime environment variables. They should use DB-provided variable names when possible, such as `PGUSER`, `PGPASSWORD`, `PGHOST`, and `PGPORT`, with conflict handling when those names are already owned by other user-authored rows. Helper variables must not be hidden metadata or a separate binding record.

The editor may keep transient per-row DB context to resolve tokens while the user is editing, but that context is not persisted unless it produces standard AP env values. Canvas AP-DB connections continue to derive from exact env evidence, especially `valueFrom.secretKeyRef` entries that point at DB credential Secrets; token editing does not introduce a separate connection model.
