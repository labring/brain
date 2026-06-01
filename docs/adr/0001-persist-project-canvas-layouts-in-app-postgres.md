# Persist Project Canvas Layouts in App Postgres

Project Canvas Layout persistence is owned by the app persistence layer, not the Crossplane Project resource. Crossplane remains the source of truth for resource identity and lifecycle, while App Postgres stores project-scoped canvas metadata such as node positions, expansion state, and stack order.

## Considered Options

- Store layout on the Crossplane Project resource: rejected because visual arrangement is application metadata and should not couple UI persistence to resource reconciliation.
- Store layout in the Assistant Chat schema: rejected because chat history and project canvas metadata are separate persistence contexts with different table ownership and migration cadence.
- Use a separate Postgres database or `DATABASE_URL`: rejected for v1 because schema-level isolation provides the needed boundary without adding another operational dependency.

## Consequences

Project canvas tables and migrations live under the `sealai_project` Postgres schema inside the existing App Postgres connection. This isolates naming, ownership, and migrations from Assistant Chat while keeping one database connection to operate. Rows reference the Project by stable Kubernetes identity (`namespace` and `metadata.uid`) so Project rename and recreate scenarios do not blur layout ownership. Canvas Layout may store visual metadata for each node, including position, expansion state, and stack order; it must not become a second source of truth for AP, DB, or EntryPoint lifecycle.
