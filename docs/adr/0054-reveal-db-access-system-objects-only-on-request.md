# Reveal DB Access System Objects Only on Request

Every platform-provisioned PostgreSQL cluster ships ~22 operator and extension objects in the `public` schema of its default logical database (Spilo `post_init`: `postgres_log*` file_fdw tables, `failed_authentication_*` views, `pg_stat_*`/`pg_auth_mon` extension views), and they interleave with user tables in the DB Access object list. We decided these are System Objects (see CONTEXT.md): DB Access omits them from the default object list and reveals them only through a per-Logical-Database "Show system objects" context-menu toggle whose state lives for one DB Access Session (ADR 0049 lifecycle); when revealed they stay inline in the normal list with muted styling rather than in a separate group.

Classification is computed where catalog structure is visible — the WhoDB plugin layer — from structural evidence, not names: extension membership (`pg_depend` with `deptype='e'`), foreign tables on a `file_fdw` server, and regular tables whose inheritance children all match; the only name-based rule is Spilo's pinned `failed_authentication_[0-7]` views (`relkind='v'`). The fingerprint query runs separately from the table-listing query and fails open: any classification error yields "no System Objects", never a broken listing. The label travels as a StorageUnit attribute through WhoDB GraphQL; `apps/api` strips the attribute and promotes it to an explicit `system` boolean on `AccessObject`, so the UI consumes a typed contract and owns only presentation policy.

## Considered Options

- Hiding System Objects unconditionally at the plugin layer (the upstream WhoDB precedent for MongoDB `system.*` and Elasticsearch dot-indices) was rejected because `pg_stat_statements` is genuinely useful for users diagnosing slow databases, and objects filtered from a shared user schema deserve a recovery path.
- An always-visible collapsed "System" group was rejected in favor of the toggle to keep the default object list purely user-authored; the trade-off is that a misclassified object is hidden by default rather than merely regrouped, which the structural fingerprints and the toggle's recovery path make acceptable.
- Classifying in the UI (the vestigial upstream mechanism: frontend schema-name lists behind a `systemObjectsToggle` capability) was rejected because the frontend only sees object names, and name matching is exactly what can misfile user tables; the legacy stubs are removed when this lands.
- Rewriting the main table-listing query with catalog joins was rejected because CockroachDB, QuestDB, and YugabyteDB plugins inherit it from `PostgresPlugin`, and a fingerprint incompatibility there must not break the core listing.
- A first-class GraphQL field through the WhoDB fork was rejected to keep the fork diff minimal; the attribute-to-boolean promotion happens at the `apps/api` contract boundary instead.

## Consequences

- Scope is every schema and Logical Database of PostgreSQL DB Services; other engines keep their existing behavior, and system-schema visibility (`pg_catalog`, `information_schema`) is out of scope.
- Revealed `postgres_log_*` tables surface real read errors, so the per-table error mapping fix (GH issue #191) ships together with this change.
